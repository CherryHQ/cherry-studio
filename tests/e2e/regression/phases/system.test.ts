import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { createDeviceIdentity } from '@cherrystudio/remote-transport'
import type { AppInfo } from '@renderer/types/app'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { isPathInside } from '../../../../scripts/e2e/regression/paths'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { openLaunchpad, selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import { launchpadPinning } from '../scenarios/launchpadPinning'

test(...caseDefinition('MP-130'), async ({ app, mainWindow }, testInfo) => {
  await launchpadPinning(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-131'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(180_000)
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  const strip = page.getByTestId('app-shell-tab-strip')
  const tabs = strip.locator('[data-tab-id]')
  const tab = (name: string) => strip.getByRole('button', { name, exact: true }).and(tabs)
  const menu = async (target: ReturnType<typeof tab>, action: string) => {
    await target.click({ button: 'right' })
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  }
  const screenshot = async (window: Page, name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(window, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = page.locator('[data-ui~="chat.view"]:visible')
  const knowledge = page.locator('[data-ui~="knowledge.view"]:visible')
  let child: Page | undefined
  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    await selectSidebarApp(page, 'Chat')
    // Normalize tabs left by earlier cases through the same close actions users have.
    const normalTabs = tabs.filter({ has: page.getByRole('button', { name: 'Close Tab', exact: true }) })
    if ((await normalTabs.count()) > 1) {
      const retainedId = await normalTabs.first().getAttribute('data-tab-id')
      await menu(strip.locator(`[data-tab-id="${retainedId}"]`), 'Close Other Tabs')
      await expect(normalTabs).toHaveCount(1)
    }
    while ((await tabs.count()) > 1) {
      const id = await tabs.last().getAttribute('data-tab-id')
      await menu(strip.locator(`[data-tab-id="${id}"]`), 'Close Tab')
      await expect(strip.locator(`[data-tab-id="${id}"]`)).toHaveCount(0)
    }
    await menu(tabs.first(), 'Close Tab')
    await expect(tab('Launchpad')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()

    await selectSidebarApp(page, 'Chat')
    await expect(chat).toBeVisible()
    const chatTab = tabs.last()
    const chatId = await chatTab.getAttribute('data-tab-id')
    expect(chatId).toBeTruthy()
    const pinned = strip.locator(`[data-tab-id="${chatId}"]`)
    await expect(tabs).toHaveCount(1)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(knowledge).toBeVisible()
    await selectSidebarApp(page, 'Settings')
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toBeVisible()
    await page.keyboard.press('Control+Shift+Tab')
    await expect(tab('Settings')).toBeVisible()
    await expect(tabs).toHaveCount(3)
    await expect(knowledge).toBeVisible()

    await menu(pinned, 'Pin Tab')
    await expect(pinned).toHaveAttribute('title', /.+/)
    await expect(pinned.getByRole('button', { name: 'Close Tab', exact: true })).toHaveCount(0)
    await pinned.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Unpin Tab', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await pinned.click({ button: 'middle' })
    await pinned.dblclick()
    await expect(pinned).toBeVisible()
    await expect(tabs).toHaveCount(3)
    await expect(chat).toBeVisible()
    await screenshot(page, 'MP-131 pinned chat with knowledge and settings tabs')

    await menu(tab('Knowledge Base'), 'Close Tabs to the Right')
    await expect(tab('Settings')).toHaveCount(0)
    await expect(pinned).toBeVisible()
    await expect(tab('Knowledge Base')).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Translation')
    await expect(tab('Translate')).toBeVisible()
    await menu(tab('Knowledge Base'), 'Close Other Tabs')
    await expect(tab('Translate')).toHaveCount(0)
    await expect(tabs).toHaveCount(2)
    await expect(pinned).toBeVisible()
    await expect(knowledge).toBeVisible()

    const knowledgeId = await tab('Knowledge Base').getAttribute('data-tab-id')
    expect(knowledgeId).toBeTruthy()
    const knowledgeContent = await knowledge.innerText()
    await menu(tab('Knowledge Base'), 'Open in New Window')
    child = await app.window('/windows/subWindow/', knowledgeId!)
    await expect(child.locator('[data-ui~="knowledge.view"]:visible')).toBeVisible()
    await expect(child.locator('[data-ui~="knowledge.view"]:visible')).toHaveText(knowledgeContent, {
      useInnerText: true
    })
    await expect(child.getByRole('button', { name: 'Back to Main Window', exact: true })).toBeVisible()
    await expect(tab('Knowledge Base')).toHaveCount(0)
    await expect(tabs).toHaveCount(1)
    await pinned.click()
    await expect(chat).toBeVisible()
    await screenshot(child, 'MP-131 knowledge base in independent window')
    await child.getByRole('button', { name: 'Back to Main Window', exact: true }).click()
    await expect.poll(() => child!.isClosed()).toBe(true)
    await page.bringToFront()
    await expect(knowledge).toBeVisible()
    await expect(tab('Knowledge Base')).toHaveAttribute('data-tab-id', knowledgeId!)
    await expect(tabs).toHaveCount(2)
    await expect(pinned).toBeVisible()
    await expect(pinned.getByRole('button', { name: 'Close Tab', exact: true })).toHaveCount(0)
    await screenshot(page, 'MP-131 knowledge returned and pinned chat preserved')

    await tab('Knowledge Base').hover()
    await tab('Knowledge Base').getByRole('button', { name: 'Close Tab', exact: true }).click()
    await expect(tabs).toHaveCount(1)
    await expect(chat).toBeVisible()
    await menu(pinned, 'Close Tab')
    await expect(tabs).toHaveCount(1)
    await expect(tab('Launchpad')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
    await expect(chat).toHaveCount(0)
    await expect(knowledge).toHaveCount(0)
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
    await screenshot(page, 'MP-131 last tab closed falls back to Launchpad')

    await selectSidebarApp(page, 'Chat')
    await expect(chat).toBeVisible()
    await expect(page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()).toBeEditable()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeHidden()
    await expect(tabs).toHaveCount(1)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(knowledge).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await screenshot(page, 'MP-131 sidebar opens working chat after Launchpad fallback')
  } finally {
    if (child && !child.isClosed()) await child.close()
    await page.evaluate((mode) => window.api.preference.set('menu.presentation_mode', mode), menuMode)
  }
})

test(...caseDefinition('MP-141'), async ({ app, mainWindow: page }, testInfo) => {
  // Catches broken gateway guidance, invitation expiry, and network-access persistence using the real gateway.
  test.setTimeout(8 * 60_000)
  testInfo.annotations.push({
    type: '未覆盖',
    description: '无实体手机：第 6 步扫码、验证码核对、允许/拒绝及配对成功后的撤销访问未覆盖；验证未扫码空态。'
  })
  const original = await page.evaluate(async () => ({
    enabled: await window.api.preference.get('feature.api_gateway.enabled'),
    host: await window.api.preference.get('feature.api_gateway.host'),
    port: await window.api.preference.get('feature.api_gateway.port')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const devices = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp141-devices', method: 'GET', path: '/api-gateway/paired-devices' })
    )
    expect(response.status).toBe(200)
    return response.data
  }
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a gateway port')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

  let identityFixture: string | undefined
  try {
    const info = (await page.evaluate(() => window.api.ipcApi.request('app.get_info'))) as IpcResult<AppInfo>
    if (!info.ok) throw new Error(info.error.message)
    expect(isPathInside(app.paths.profiles, info.data.appDataPath)).toBe(true)
    const runtime = join(info.data.appDataPath, 'Runtime')
    const plainIdentity = join(runtime, 'remote-identity.key')
    if (!existsSync(plainIdentity) && !existsSync(join(runtime, 'remote-identity.enc'))) {
      await mkdir(runtime, { recursive: true })
      await writeFile(plainIdentity, Buffer.from(await createDeviceIdentity()).toString('base64'), {
        mode: 0o600,
        flag: 'wx'
      })
      identityFixture = plainIdentity
    }
    testInfo.annotations.push({
      type: 'data-source',
      description:
        'Uses a valid profile-owned device identity; system keychain creation is outside this pairing UI scenario.'
    })
    const stopped = await page.evaluate(() => window.api.ipcApi.request('api_gateway.stop'))
    expect(stopped).toEqual({ ok: true, data: { success: true, outcome: 'stopped' } })
    await page.evaluate(
      (port) =>
        window.api.preference.setMultiple({
          'feature.api_gateway.host': '127.0.0.1',
          'feature.api_gateway.port': port
        }),
      port
    )
    expect(await devices()).toEqual([])
    await openSettingsSection(page, 'Device Connections')
    const settings = () => page.locator('[data-ui~="settings.view"]:visible')
    await expect(
      settings().getByText('Connect mobile devices over a local, company or VPN network.', { exact: true })
    ).toBeVisible()
    const continueButton = () =>
      page.getByRole('button', { name: 'Already installed? Connect your device', exact: true })
    if (!(await continueButton().isVisible())) {
      await page.getByRole('button', { name: 'Download mobile app', exact: true }).click()
    }
    await expect(continueButton()).toBeVisible()
    await expect(page.getByRole('button', { name: 'iOS · App Store', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Android', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Get it on Google Play', exact: true })).toBeVisible()
    await screenshot('MP-141 mobile download guide')
    await continueButton().click()
    await expect(page.getByRole('button', { name: 'Download mobile app', exact: true })).toBeVisible()
    await expect(
      settings()
        .getByText('Start the gateway in API Gateway settings before allowing network access.', { exact: true })
        .first()
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow network access', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Open API Gateway settings', exact: true }).click()
    await expect(settings().getByText('Stopped', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(settings().getByText('Running', { exact: true })).toBeVisible()
    await openSettingsSection(page, 'Device Connections')
    await page.getByRole('button', { name: 'Allow network access', exact: true }).click()
    await expect(settings().getByText('Network access is allowed', { exact: true })).toBeVisible()
    await expect(
      settings().getByText(
        'Scan with the Cherry Studio mobile app. The invitation is single-use and expires in 2 minutes.',
        { exact: true }
      )
    ).toBeVisible()
    const qr = () =>
      settings()
        .locator('svg')
        .filter({ has: page.locator('title', { hasText: /^Pair a device$/ }) })
    await expect(qr()).toBeVisible()
    await expect(settings().getByText('No devices have been paired yet.', { exact: true })).toBeVisible()

    const createdAt = Date.now()
    await expect(settings().getByText('QR code expired', { exact: true })).toBeVisible({ timeout: 130_000 })
    expect(Date.now() - createdAt).toBeGreaterThanOrEqual(115_000)
    await expect(qr()).toHaveCount(0)
    await screenshot('MP-141 invitation expired after two minutes')
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(qr()).toBeVisible()
    await expect(settings().getByText('QR code expired', { exact: true })).toHaveCount(0)
    const connectionAddress = () => page.getByRole('combobox', { name: 'Connection address', exact: true })
    await connectionAddress().click()
    const options = page.getByRole('option')
    expect(await options.count()).toBeGreaterThan(1)
    const selectedAddress = (await options.nth(1).innerText()).trim()
    await options.nth(1).click()
    await expect(connectionAddress()).toContainText(selectedAddress)
    const oldQr = await qr().innerHTML()
    await page.getByRole('button', { name: 'Refresh addresses', exact: true }).click()
    const unavailable = settings().getByText('The selected address is no longer available. Choose another address.', {
      exact: true
    })
    // Refreshing can drop the address in use: the code then disappears and the alert replaces it.
    await expect(qr().or(unavailable).first()).toBeVisible({ timeout: 30_000 })
    if (await unavailable.isVisible()) {
      await connectionAddress().click()
      await page.getByRole('option', { name: 'Automatic', exact: true }).click()
      await expect(unavailable).toHaveCount(0)
      await expect(qr()).toBeVisible()
      await expect.poll(async () => qr().innerHTML()).not.toBe(oldQr)
      await screenshot('MP-141 address recovered after refresh')
    } else {
      await expect.poll(async () => qr().innerHTML()).not.toBe(oldQr)
    }
    await expect(qr()).toBeVisible()
    await connectionAddress().click()
    expect(await options.count()).toBeGreaterThan(1)
    await page.keyboard.press('Escape')
    await expect(qr()).toBeVisible()
    expect(await devices()).toEqual([])

    await page.getByRole('button', { name: 'Disable network access', exact: true }).click()
    await expect(settings().getByText('Network access is off', { exact: true })).toBeVisible()
    await expect(settings().getByText('Allow network access to pair devices.', { exact: true })).toBeVisible()
    await expect(qr()).toHaveCount(0)
    const blockedPairing = await page.evaluate(() => window.api.ipcApi.request('api_gateway.remote.create_invitation'))
    expect(blockedPairing).toMatchObject({ ok: false })
    const savedHost = await page.evaluate(() => window.api.preference.get('feature.api_gateway.host'))
    expect(savedHost).toBe('127.0.0.1')
    await screenshot('MP-141 network access disabled and no paired devices')
    page = await app.restart()
    await openSettingsSection(page, 'Device Connections')
    await expect(settings().getByText('Network access is off', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow network access', exact: true })).toBeVisible()
    await expect(settings().getByText('Allow network access to pair devices.', { exact: true })).toBeVisible()
    await expect(settings().getByText('No devices have been paired yet.', { exact: true })).toBeVisible()
    expect(await devices()).toEqual([])
    expect(await page.evaluate(() => window.api.preference.get('feature.api_gateway.host'))).toBe(savedHost)
    await expect(qr()).toHaveCount(0)
    await screenshot('MP-141 disabled state persists after restart')
  } finally {
    try {
      await page.evaluate(async (original) => {
        await window.api.ipcApi.request('api_gateway.lan.set_enabled', { enabled: false })
        await window.api.ipcApi.request('api_gateway.stop')
        await window.api.preference.setMultiple({
          'feature.api_gateway.host': original.host,
          'feature.api_gateway.port': original.port
        })
        if (original.enabled) await window.api.ipcApi.request('api_gateway.start')
      }, original)
    } finally {
      if (identityFixture) await rm(identityFixture, { force: true })
    }
  }
})
