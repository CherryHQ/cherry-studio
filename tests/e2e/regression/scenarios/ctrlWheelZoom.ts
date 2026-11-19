import { readFile, writeFile } from 'node:fs/promises'

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

import type { FileEntry } from '@shared/data/types/file'
import type { Painting } from '@shared/data/types/painting'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { BatchMutationResult } from '@shared/types/file/ipc'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

interface WheelMetadata {
  isTrusted: boolean
  ctrlKey: boolean
  deltaY: number
  deltaMode: number
  cancelable: boolean
}
type ProbeWindow = Window & { __ctrlWheelZoomEvent?: WheelMetadata }

export async function ctrlWheelZoom(app: RegressionApp, mainWindow: Page, testInfo: TestInfo): Promise<void> {
  let page = mainWindow
  let child: Page | undefined
  let detachedTabId: string | undefined
  let paintingId: string | undefined
  let file: FileEntry | undefined
  const events: Array<WheelMetadata & { name: string }> = []
  const previousFactor = await page.evaluate(() => window.api.preference.get('app.zoom_factor'))
  const zoomToasts = (target: Page) =>
    target.getByRole('status', { includeHidden: true }).filter({ hasText: 'Page Zoom' }).filter({ visible: true })
  const screenshot = async (target: Page, name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(target, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const adjust = async (delta: number, reset = false) => {
    const result = (await page.evaluate((input) => window.api.ipcApi.request('app.adjust_zoom', input), {
      delta,
      reset
    })) as IpcResult<number>
    await testInfo.attach('ZOOM-01 adjust zoom envelope', {
      body: JSON.stringify(result),
      contentType: 'application/json'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Zoom RPC failed: ${result.error.code}`)
    return result.data
  }
  const wheel = async (surface: Locator, name: string, deltaY = -100, control = true) => {
    const target = surface.page()
    await target.bringToFront()
    await surface.hover()
    await target.evaluate(() => {
      const probeWindow = window as ProbeWindow
      delete probeWindow.__ctrlWheelZoomEvent
      window.addEventListener(
        'wheel',
        (event) => {
          probeWindow.__ctrlWheelZoomEvent = {
            isTrusted: event.isTrusted,
            ctrlKey: event.ctrlKey,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            cancelable: event.cancelable
          }
        },
        { capture: true, once: true }
      )
    })
    try {
      if (control) await target.keyboard.down('Control')
      await target.mouse.wheel(0, deltaY)
    } finally {
      if (control) await target.keyboard.up('Control')
    }
    await target.waitForFunction(() => (window as ProbeWindow).__ctrlWheelZoomEvent !== undefined)
    const delivered = await target.evaluate(() => (window as ProbeWindow).__ctrlWheelZoomEvent!)
    events.push({ name, ...delivered })
    await target.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    )
  }
  const observe = async (target: Page) => ({
    factor: await target.evaluate(() => window.api.preference.get('app.zoom_factor')),
    dpr: await target.evaluate(() => window.devicePixelRatio),
    feedback: await zoomToasts(target).allTextContents(),
    settings: await target.locator('#setting-appearance-zoom:visible').allTextContents()
  })
  let baselineDpr = 1
  const check = async (
    target: Page,
    name: string,
    factor: number,
    options: { feedback?: boolean; settings?: boolean } = {}
  ) => {
    const percentage = `${Math.round(factor * 100)}%`
    let state = await observe(target)
    const deadline = Date.now() + 1000
    while (
      Date.now() < deadline &&
      (state.factor !== factor ||
        Math.abs(state.dpr / baselineDpr - factor) > 0.01 ||
        (options.feedback && !state.feedback.some((text) => text.includes(percentage))) ||
        (options.settings && !state.settings.some((text) => text.includes(percentage))))
    ) {
      await target.waitForTimeout(50)
      state = await observe(target)
    }
    await screenshot(target, name)
    await testInfo.attach(`${name} observation`, { body: JSON.stringify(state), contentType: 'application/json' })
    expect(state.factor).toBe(factor)
    expect(state.dpr / baselineDpr).toBeCloseTo(factor, 2)
    if (options.feedback) {
      expect(state.feedback).toHaveLength(1)
      expect(state.feedback[0]).toContain(percentage)
    }
    if (options.settings) {
      expect
        .soft(
          state.settings.join(' '),
          'AppearanceSettings/AppearanceSettings.tsx fence: mounted zoom percentage must follow external adjustments'
        )
        .toContain(percentage)
    }
    return state
  }
  const detach = async () => {
    const tab = page.getByTestId('app-shell-tab-strip').locator(`[data-tab-id="${detachedTabId}"]`)
    await tab.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in New Window', exact: true }).click()
    child = await app.window('/windows/subWindow/', detachedTabId)
    await child.bringToFront()
    await child.locator('[data-ui~="knowledge.view"]:visible').waitFor({ state: 'visible' })
    return child
  }

  try {
    const resetFactor = await adjust(0, true)
    baselineDpr = await page.evaluate(() => window.devicePixelRatio)
    await screenshot(page, 'ZOOM-01 baseline 100 percent on fixed display')
    expect(resetFactor).toBe(1)
    await selectSidebarApp(page, 'Chat')
    const ordinaryHost = () => page.locator('[data-ui~="app.sidebar"]')
    await wheel(ordinaryHost(), 'main increase')
    await check(page, 'ZOOM-01 main 110 percent', 1.1, { feedback: true })
    const firstToastStillVisible = await zoomToasts(page).isVisible()
    await wheel(ordinaryHost(), 'main reverse before toast expiry', 100)
    await check(page, 'ZOOM-01 reverse replaces toast with 100 percent', 1, { feedback: true })
    expect(firstToastStillVisible).toBe(true)

    await wheel(ordinaryHost(), 'plain wheel', -100, false)
    await page.waitForTimeout(200)
    await check(page, 'ZOOM-01 plain wheel keeps zoom', 1)
    await wheel(ordinaryHost(), 'before keyboard reset')
    await check(page, 'ZOOM-01 nondefault before keyboard reset', 1.1)
    // Playwright cannot synthesize native accelerators, so Ctrl+0 delivery stays outside this case.
    // This step covers the reset command path invoked by the accelerator.
    await zoomToasts(page).waitFor({ state: 'hidden' })
    await adjust(0, true)
    const reset = await check(page, 'ZOOM-01 existing reset shortcut', 1)
    expect(reset.feedback).toEqual([])

    await openSettingsSection(page, 'Appearance')
    const zoomRow = () => page.locator('#setting-appearance-zoom')
    await zoomRow().scrollIntoViewIfNeeded()
    await screenshot(page, 'ZOOM-01 Appearance mounted before wheel')
    expect(await zoomRow().isVisible()).toBe(true)
    await wheel(zoomRow().getByText('Page Zoom', { exact: true }), 'mounted Appearance increase')
    await check(page, 'ZOOM-01 mounted Appearance updates without reopening or resize', 1.1, {
      settings: true,
      feedback: true
    })
    await wheel(zoomRow().getByText('Page Zoom', { exact: true }), 'Appearance persistence increase')
    await check(page, 'ZOOM-01 Appearance before restart', 1.2, { settings: true })
    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await openSettingsSection(page, 'Appearance')
    await zoomRow().scrollIntoViewIfNeeded()
    await check(page, 'ZOOM-01 saved zoom and DPR survive restart', 1.2, { settings: true })

    await adjust(0, true)
    await selectSidebarApp(page, 'Knowledge Base')
    const knowledgeTab = page
      .getByTestId('app-shell-tab-strip')
      .getByRole('button', { name: 'Knowledge Base', exact: true })
    detachedTabId = (await knowledgeTab.getAttribute('data-tab-id'))!
    await screenshot(page, 'ZOOM-01 tab identity before detach')
    expect(detachedTabId).toBeTruthy()
    let detached = await detach()
    const detachedHost = () => detached.getByRole('button', { name: 'Back to Main Window', exact: true })
    await wheel(detachedHost(), 'detached first mount')
    await check(detached, 'ZOOM-01 detached single step', 1.1, { feedback: true })
    await check(page, 'ZOOM-01 detached RPC also updates main', 1.1)
    await detached.getByRole('button', { name: 'Back to Main Window', exact: true }).click()
    await page.bringToFront()
    await selectSidebarApp(page, 'Chat')
    await wheel(ordinaryHost(), 'after main tab switch')
    await check(page, 'ZOOM-01 main tab switch retains one listener', 1.2, { feedback: true })
    await selectSidebarApp(page, 'Knowledge Base')
    detached = await detach()
    await wheel(detachedHost(), 'detached reopened')
    await check(detached, 'ZOOM-01 reopened detached single step', 1.3, { feedback: true })
    await detached.getByRole('button', { name: 'Back to Main Window', exact: true }).click()
    child = undefined
    await page.bringToFront()

    const image = await readFile('resources/data/painting-templates/images/monochrome-suit.webp')
    const entry: FileEntry = await page.evaluate(
      (data) =>
        window.api.file.createInternalEntry({
          source: 'bytes',
          data: new Uint8Array(data),
          name: 'ZOOM-01 ownership',
          ext: 'webp',
          cleanupPolicy: 'manual'
        }),
      [...image]
    )
    file = entry
    const created = await page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'zoom01-painting',
          method: 'POST',
          path: '/paintings',
          body: { providerId: 'silicon', prompt: 'ZOOM-01 image ownership', files: { input: [], output: [id] } }
        }),
      entry.id
    )
    paintingId = (created.data as Painting).id
    expect(created.status).toBe(201)
    await page.reload()
    await selectSidebarApp(page, 'Paintings')
    const view = page.locator('[data-ui~="paintings.view"]:visible')
    await view.getByRole('button', { name: 'Select Image', exact: true }).first().click()
    const artboardImage = view.getByTestId('artboard-image-transform')
    await artboardImage.waitFor({ state: 'visible' })
    await zoomToasts(page).waitFor({ state: 'hidden' })
    let artboardDpr = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      await adjust(0, true)
      artboardDpr = await page.evaluate(() => window.devicePixelRatio)
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && Math.abs(artboardDpr / baselineDpr - 1) > 0.01) {
        await page.waitForTimeout(50)
        artboardDpr = await page.evaluate(() => window.devicePixelRatio)
      }
      if (Math.abs(artboardDpr / baselineDpr - 1) <= 0.01) break
    }
    expect(
      Math.abs(artboardDpr / baselineDpr - 1),
      `Artboard reset: DPR=${artboardDpr}, baselineDpr=${baselineDpr}, ratio=${artboardDpr / baselineDpr}`
    ).toBeLessThanOrEqual(0.01)
    const beforeArtboard = await artboardImage.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return Math.hypot(matrix.a, matrix.b)
    })
    await wheel(view.getByTestId('artboard-viewer'), 'artboard owns Ctrl-wheel')
    await page.waitForTimeout(200)
    const afterArtboard = await artboardImage.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return Math.hypot(matrix.a, matrix.b)
    })
    const artboard = await check(page, 'ZOOM-01 artboard owns image zoom', 1)
    expect(afterArtboard).toBeGreaterThan(beforeArtboard)
    expect(artboard.feedback).toEqual([])

    await artboardImage.click()
    const preview = page.getByTestId('image-preview-dialog')
    await preview.waitFor({ state: 'visible' })
    const previewImage = preview.getByTestId('image-preview-viewport').locator('img')
    await previewImage.waitFor({ state: 'visible' })
    const beforePreview = await previewImage.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return Math.hypot(matrix.a, matrix.b)
    })
    await wheel(preview.getByTestId('image-preview-viewport'), 'shared preview owns Ctrl-wheel')
    await page.waitForTimeout(200)
    const afterPreview = await previewImage.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return Math.hypot(matrix.a, matrix.b)
    })
    const sharedPreview = await check(page, 'ZOOM-01 shared preview owns image zoom', 1)
    expect(afterPreview).toBeGreaterThan(beforePreview)
    expect(sharedPreview.feedback).toEqual([])
    await page.keyboard.press('Escape')

    for (const event of events) {
      expect(event.isTrusted, event.name).toBe(true)
      expect(event.ctrlKey, event.name).toBe(event.name !== 'plain wheel')
      expect(Math.sign(event.deltaY), event.name).toBe(event.name.includes('reverse') ? 1 : -1)
    }
  } finally {
    const path = testInfo.outputPath('ZOOM-01 delivered wheel events.json')
    await writeFile(path, JSON.stringify(events, null, 2))
    await testInfo.attach('ZOOM-01 delivered wheel events', { path, contentType: 'application/json' })
    page = await app.mainWindow()
    try {
      await adjust(0, true)
      const restored = await adjust(previousFactor - 1)
      expect(restored).toBe(previousFactor)
    } finally {
      if (child && !child.isClosed()) await child.evaluate(() => window.api.ipcApi.request('window.close'))
      if (paintingId) {
        for (const permanent of [false, true]) {
          const removed = await page.evaluate(
            ({ id, permanent }) =>
              window.api.dataApi.request({
                id: 'zoom01-cleanup',
                method: 'DELETE',
                path: `/paintings/${id}`,
                params: { permanent }
              }),
            { id: paintingId, permanent }
          )
          expect(removed.status).toBe(204)
        }
      }
      if (file) {
        for (const route of ['file.batch_trash', 'file.batch_permanent_delete_from_trash'] as const) {
          const result = (await page.evaluate(({ route, id }) => window.api.ipcApi.request(route, { ids: [id] }), {
            route,
            id: file.id
          })) as IpcResult<BatchMutationResult>
          expect(result.ok).toBe(true)
          if (!result.ok) throw new Error(`File cleanup failed: ${result.error.code}`)
          expect(result.data.failed).toEqual([])
        }
      }
    }
  }
}
