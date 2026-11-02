import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { _electron as electron, type Locator } from '@playwright/test'

import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    try {
      const app = await electron.launch({
        args: ['.'],
        env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
        timeout: 60000
      })
      try {
        await use(app)
      } finally {
        await app.close().catch(() => {})
      }
    } finally {
      await rm(profile, { recursive: true, force: true }).catch(() => {})
    }
  }
})

// Include ancestors: Playwright visibility alone accepts fully transparent controls.
async function effectiveOpacity(control: Locator) {
  return control.evaluate((element) => {
    let opacity = 1
    for (let current: Element | null = element; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity)
    }
    return opacity
  })
}

test('chat prose file links reveal the exact file through native shell on mouse, keyboard and touch', async ({
  mainWindow: page,
  electronApp
}, testInfo) => {
  const directory = testInfo.outputPath('files')
  await mkdir(directory, { recursive: true })
  const filePath = join(directory, 'reveal-note.md')
  await writeFile(filePath, '# Reveal smoke fixture\n')
  const topicName = `File reveal ${Date.now()}`
  let assistantId: string | undefined
  let preferences: Awaited<ReturnType<typeof readPreferences>> | undefined
  const cdp = await page.context().newCDPSession(page)
  async function readPreferences() {
    return page.evaluate(async () => ({
      'app.language': await window.api.preference.get('app.language'),
      'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status'),
      'app.privacy.policy_version': await window.api.preference.get('app.privacy.policy_version'),
      'chat.message.style': await window.api.preference.get('chat.message.style')
    }))
  }
  await electronApp.evaluate(({ shell }) => {
    const originalShowItemInFolder = shell.showItemInFolder
    const originalOpenPath = shell.openPath
    const calls: string[] = []
    const openPathCalls: string[] = []
    Object.assign(globalThis, {
      fileLinkRevealRecorder: {
        calls,
        openPathCalls,
        restore: () => {
          shell.showItemInFolder = originalShowItemInFolder
          shell.openPath = originalOpenPath
        }
      }
    })
    shell.showItemInFolder = (path) => {
      calls.push(path)
    }
    shell.openPath = async (path) => {
      openPathCalls.push(path)
      return ''
    }
  })
  const shellCalls = () =>
    electronApp.evaluate(
      () =>
        (globalThis as typeof globalThis & { fileLinkRevealRecorder: { calls: string[] } }).fileLinkRevealRecorder.calls
    )
  const openPathCalls = () =>
    electronApp.evaluate(
      () =>
        (globalThis as typeof globalThis & { fileLinkRevealRecorder: { openPathCalls: string[] } })
          .fileLinkRevealRecorder.openPathCalls
    )
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path })
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  try {
    preferences = await readPreferences()
    await page.evaluate(
      (policyVersion) =>
        window.api.preference.setMultiple({
          'app.language': 'en-US',
          'app.onboarding.provider_setup.status': 'skipped',
          'app.privacy.policy_version': policyVersion,
          'chat.message.style': 'plain'
        }),
      LATEST_PRIVACY_POLICY_VERSION
    )
    assistantId = await page.evaluate(
      async ({ topicName, filePath }) => {
        const assistantResponse = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/assistants',
          body: { name: topicName }
        })
        if (assistantResponse.error) throw new Error(assistantResponse.error.message)
        const assistant = assistantResponse.data as { id: string }
        const topicResponse = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/topics',
          body: { name: topicName, assistantId: assistant.id }
        })
        if (topicResponse.error) throw new Error(topicResponse.error.message)
        const topic = topicResponse.data as { id: string }
        for (const [role, text] of [
          ['user', 'Where is my document?'],
          ['assistant', `Created ${filePath}`]
        ]) {
          const message = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: `/topics/${topic.id}/messages`,
            body: { role, data: { parts: [{ type: 'text', text }] }, status: 'success' }
          })
          if (message.error) throw new Error(message.error.message)
        }
        return assistant.id
      },
      { topicName, filePath }
    )
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const row = page.getByRole('option').filter({ hasText: topicName })
    if (!(await row.isVisible())) {
      await page.getByRole('listbox').getByRole('button', { name: topicName, exact: true }).click()
    }
    await row.click()
    const message = page.locator('[data-ui~="chat.message"]').filter({ hasText: `Created ${filePath}` })
    const link = message.getByRole('link', { name: filePath, exact: true })
    const reveal = message.getByRole('button', {
      name: /^(Reveal in Finder|Show in File Explorer|Show in File Manager)$/
    })
    const previews = page.locator('[data-testid="artifact-file-preview-overlay"], [data-ui~="file-preview.view"]')
    await expect(link).toBeVisible()
    await page.mouse.move(1, 1)
    await page.getByRole('button', { name: 'Launchpad', exact: true }).last().focus()
    await expect(reveal).toHaveCount(1)
    await expect.poll(() => effectiveOpacity(reveal)).toBe(0)
    await expect(reveal).toHaveCSS('pointer-events', 'none')
    await expect(previews.filter({ visible: true })).toHaveCount(0)
    await screenshot('file-link-rest')

    await link.hover()
    await expect.poll(() => effectiveOpacity(reveal)).toBe(1)
    await expect(reveal).toHaveCSS('pointer-events', 'auto')
    await screenshot('file-link-hover')
    await reveal.click()
    await expect.poll(shellCalls).toEqual([filePath])
    await expect(previews.filter({ visible: true })).toHaveCount(0)

    await page.mouse.move(1, 1)
    await link.focus()
    await page.keyboard.press('Tab')
    await expect(reveal).toBeFocused()
    await expect.poll(() => effectiveOpacity(reveal)).toBe(1)
    await screenshot('file-link-keyboard-focus')
    await page.keyboard.press('Enter')
    await expect.poll(shellCalls).toEqual([filePath, filePath])
    await page.keyboard.press('Space')
    await expect.poll(shellCalls).toEqual([filePath, filePath, filePath])
    await expect(previews.filter({ visible: true })).toHaveCount(0)

    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
    await page.getByRole('button', { name: 'Launchpad', exact: true }).last().focus()
    await page.mouse.move(1, 1)
    await expect.poll(() => effectiveOpacity(reveal)).toBe(1)
    await expect(reveal).toHaveCSS('pointer-events', 'auto')
    await reveal.scrollIntoViewIfNeeded()
    expect(
      await reveal.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return hit !== null && element.contains(hit)
      })
    ).toBe(true)
    await screenshot('file-link-no-hover')
    const bounds = await reveal.boundingBox()
    if (!bounds) throw new Error('Reveal button has no touch bounds')
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(shellCalls).toEqual([filePath, filePath, filePath, filePath])
    await expect(previews.filter({ visible: true })).toHaveCount(0)
    expect(await openPathCalls()).toEqual([])

    await link.click()
    await expect.poll(openPathCalls).toEqual([filePath])
    expect(await shellCalls()).toEqual([filePath, filePath, filePath, filePath])
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {})
    await cdp.detach().catch(() => {})
    await electronApp
      .evaluate(() => {
        const state = globalThis as typeof globalThis & { fileLinkRevealRecorder?: { restore: () => void } }
        state.fileLinkRevealRecorder?.restore()
        delete state.fileLinkRevealRecorder
      })
      .catch(() => {})
    if (assistantId)
      await page
        .evaluate(
          (assistantId) =>
            window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true }),
          assistantId
        )
        .catch(() => {})
    if (preferences)
      await page.evaluate((values) => window.api.preference.setMultiple(values), preferences).catch(() => {})
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})
