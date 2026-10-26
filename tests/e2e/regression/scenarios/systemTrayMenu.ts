import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import {
  assertOwnedProcess,
  isAlive,
  waitForExit,
  waitForPortRelease
} from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { nativeComputerUse } from '../helpers/computerUseNative'
import type { RegressionApp } from '../RegressionApp'

export async function systemTrayMenu(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('UNCOVERED: native tray automation requires macOS')
  const original = await page.evaluate(async () => ({
    tray: await window.api.preference.get('app.tray.enabled'),
    language: await window.api.preference.get('app.language')
  }))
  let assistantId: string | undefined
  const assistantName = app.resourceName(`Tray persistence ${Date.now()}`)
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const openTray = async () => {
    const record = app.record
    assertOwnedProcess(record, record.electronPid, 'electron')
    await expect.poll(readMenu, { timeout: 5_000 }).toEqual([])
    execFileSync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        `
      ObjC.import('CoreGraphics')
      const process = Application('System Events').processes.whose({unixId: ${record.electronPid}})[0]
      const item = process.menuBars[1].menuBarItems[0]
      const position = item.position(), size = item.size()
      const point = {x: position[0] + size[0] / 2, y: position[1] + size[1] / 2}
      $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 3, point, 1))
      $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 4, point, 1))
    `
      ],
      { encoding: 'utf8', timeout: 10_000 }
    )
    await expect.poll(readMenu, { timeout: 5_000 }).toContain('Quit')
  }
  const readMenu = () =>
    nativeComputerUse(`
    tell application "System Events" to tell (first process whose unix id is ${app.record.electronPid})
      try
        set actualNames to name of every menu item of menu 1 of menu bar item 1 of menu bar 2
      on error number -1719
        return ""
      end try
      set labels to {}
      repeat with entry in actualNames
        if contents of entry is not missing value then set end of labels to contents of entry
      end repeat
      set AppleScript's text item delimiters to linefeed
      return labels as text
    end tell
  `)
      .split('\n')
      .filter(Boolean)
  const clickMenu = (label: string) =>
    nativeComputerUse(`
    tell application "System Events" to tell (first process whose unix id is ${app.record.electronPid})
      click menu item ${JSON.stringify(label)} of menu 1 of menu bar item 1 of menu bar 2
    end tell
  `)

  try {
    await page.evaluate(() => window.api.preference.setMultiple({ 'app.tray.enabled': true, 'app.language': 'en-US' }))
    const created = await page.evaluate(
      (name) =>
        window.api.dataApi.request({
          id: 'mp132-create',
          method: 'POST',
          path: '/assistants',
          body: { name, prompt: 'MP-132: retain this assistant after quitting from the native tray.' }
        }),
      assistantName
    )
    expect(created.status).toBe(201)
    assistantId = AssistantSchema.parse(created.data).id
    await screenshot('MP-132 main window before tray actions')
    await expect
      .poll(() =>
        nativeComputerUse(`
      tell application "System Events" to tell (first process whose unix id is ${app.record.electronPid})
        return count of menu bar items of menu bar 2
      end tell
    `)
      )
      .toBe('1')
    await openTray()
    await expect.poll(readMenu).toEqual(['Show Window', 'Selection Assistant - Off', 'Quit'])
    await testInfo.attach('MP-132 native tray menu labels', { body: readMenu().join('\n'), contentType: 'text/plain' })

    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible')
    // Closing the main window while the tray is enabled hides it; Show Window must bring it back.
    await page.evaluate(() => window.api.ipcApi.request('window.close'))
    await expect
      .poll(() => page.evaluate(() => document.visibilityState), {
        message: 'Closing the main window with the tray enabled must hide it',
        timeout: 10_000
      })
      .toBe('hidden')
    await openTray()
    clickMenu('Show Window')
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible')
    await screenshot('MP-132 main window restored by the tray Show Window action')

    const before = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp132-before', method: 'GET', path: '/assistants' })
    )
    expect(before.status).toBe(200)
    expect(before.data).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: assistantId, name: assistantName })])
    })
    const record = app.record
    const processRows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)!)
    const ownedPids = new Set([record.electronPid])
    for (let depth = 0; depth < 32; depth++) {
      for (const row of processRows) if (ownedPids.has(Number(row[2]))) ownedPids.add(Number(row[1]))
    }
    await openTray()
    clickMenu('Quit')
    expect(await waitForExit(record.electronPid, 15_000), 'Tray Quit must exit without controller termination').toBe(
      true
    )
    expect(await waitForPortRelease(record.platform, record.cdpPort, 5_000)).toBe(true)
    await expect.poll(() => [...ownedPids].filter(isAlive), { timeout: 15_000 }).toEqual([])
    await testInfo.attach('MP-132 exited application process IDs', {
      body: [...ownedPids].join('\n'),
      contentType: 'text/plain'
    })

    page = await app.restart()
    expect(app.record.electronPid).not.toBe(record.electronPid)
    const after = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp132-after', method: 'GET', path: '/assistants' })
    )
    expect(after.status).toBe(200)
    expect(after.data).toEqual(before.data)
    await expect.poll(() => page.evaluate(() => window.api.preference.get('app.tray.enabled'))).toBe(true)
    await screenshot('MP-132 restarted application with preserved data')
  } finally {
    if (page.isClosed()) page = await app.restart()
    if (assistantId)
      await page.evaluate(async (assistantId) => {
        await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
        await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
      }, assistantId)
    await page.evaluate(
      ({ tray, language }) =>
        window.api.preference.setMultiple({
          'app.tray.enabled': tray,
          'app.language': language
        }),
      original
    )
  }
}
