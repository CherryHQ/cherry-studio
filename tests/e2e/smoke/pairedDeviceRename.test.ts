import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron, expect, test as base, type Page } from '@playwright/test'

const test = base.extend<{ isolatedProfile: string }>({
  isolatedProfile: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-e2e-device-rename-'))
    const previousProfile = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = dir
    try {
      await use(dir)
    } finally {
      if (previousProfile === undefined) delete process.env.CS_DEV_PROFILE_ROOT
      else process.env.CS_DEV_PROFILE_ROOT = previousProfile
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})

async function openDeviceConnections(page: Page) {
  const languageSelect = page.locator('[data-onboarding-language-select]')
  await expect(page.locator('[data-ui="app.content"]').first().or(languageSelect).first()).toBeVisible({
    timeout: 120_000
  })
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click({ timeout: 60_000 })
    await page.getByRole('option', { name: 'English', exact: false }).click({ timeout: 60_000 })
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator('[data-ui="app.content"]').first().isVisible()) break
    const setUpLater = page.getByRole('button', { name: 'Set up later', exact: true })
    await setUpLater.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
    if (await setUpLater.isVisible()) {
      await setUpLater.click({ timeout: 60_000 })
      await page.waitForTimeout(1_000)
    }
  }
  await expect(
    page.locator('[data-ui="app.content"]').first(),
    'App shell should appear after onboarding dismissal'
  ).toBeVisible({
    timeout: 60_000
  })
  if (!(await page.locator('[data-ui="settings.view"]').isVisible())) {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 60_000 })
  }
  await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 60_000 })

  const pairedDevices = page.getByText('Paired devices', { exact: true })
  const connect = page.getByRole('button', { name: 'Already installed? Connect your device', exact: true })
  if (!(await pairedDevices.isVisible()) && !(await connect.isVisible())) {
    await page
      .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
      .filter({ hasText: 'Device Connections' })
      .click({ timeout: 60_000 })
  }
  await expect(pairedDevices.or(connect).first()).toBeVisible({ timeout: 60_000 })
  if (await connect.isVisible()) await connect.click({ timeout: 60_000 })
  await expect(pairedDevices).toBeVisible({ timeout: 60_000 })
}

test('paired device custom names persist across app restarts', async ({ isolatedProfile }, testInfo) => {
  test.setTimeout(300_000)
  let electronPath: unknown
  try {
    electronPath = require('electron')
  } catch (error) {
    test.skip(true, `Electron executable path is unavailable: ${String(error)}`)
  }
  if (typeof electronPath !== 'string' || !electronPath) {
    test.skip(true, 'The electron package did not return an executable path')
    return
  }
  const launch = () =>
    electron.launch({
      args: ['.'],
      env: { ...process.env, CS_DEV_PROFILE_ROOT: isolatedProfile, NODE_ENV: 'development' },
      timeout: 60_000
    })
  let app: Awaited<ReturnType<typeof launch>> | undefined
  let appClosed = true
  const closeApp = async () => {
    if (!app || appClosed) return
    appClosed = true
    await app.close()
  }
  try {
    app = await launch()
    appClosed = false
    let page = await app.firstWindow()
    await openDeviceConnections(page)
    await closeApp()

    // core/paths/constants.ts:82 resolves DEV_PROFILE_ROOT to <root>/userData;
    // core/paths/pathRegistry.ts:50,97 appends Data/cherrystudio.sqlite (both under src/main/).
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-e2e-device-seed-'))
    try {
      const seedScript = path.join(seedDir, 'seed.cjs')
      fs.writeFileSync(
        seedScript,
        `const { randomUUID } = require('node:crypto')
const Database = require(require.resolve('better-sqlite3', { paths: [process.cwd()] }))
const db = new Database(process.argv[2])
try {
  const insert = db.prepare(\`INSERT INTO api_gateway_paired_device
    (id, name, platform, peer_identity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)\`)
  for (const identity of ['kitchen-phone', 'other-phone']) {
    const now = Date.now()
    insert.run(randomUUID(), 'iPhone', 'ios', identity, now, now)
  }
} finally {
  db.close()
}
`
      )
      execFileSync(electronPath, [seedScript, path.join(isolatedProfile, 'userData', 'Data', 'cherrystudio.sqlite')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true })
    }

    app = await launch()
    appClosed = false
    page = await app.firstWindow()
    await openDeviceConnections(page)
    await expect(page.getByText('iPhone', { exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: 'Rename device', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Rename device', exact: true })
    await expect(dialog.getByLabel('Device name', { exact: true })).toHaveValue('iPhone')
    await dialog.getByLabel('Device name', { exact: true }).fill('Kitchen iPhone')
    await page.screenshot({ path: testInfo.outputPath('rename-dialog.png') })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Kitchen iPhone', { exact: true })).toBeVisible()
    await expect(page.getByText('iPhone', { exact: true })).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('renamed-devices.png') })
    await closeApp()

    app = await launch()
    appClosed = false
    page = await app.firstWindow()
    await openDeviceConnections(page)
    await expect(page.getByText('Kitchen iPhone', { exact: true })).toBeVisible()
    await expect(page.getByText('iPhone', { exact: true })).toHaveCount(1)
  } finally {
    await closeApp()
  }
})
