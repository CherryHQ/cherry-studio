import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { isAlive } from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function feishuChannelSettings(app: RegressionApp, initialPage: Page, testInfo: TestInfo): Promise<void> {
  // Catches lost persisted toggles, competing credential saves, and cross-field/channel contamination.
  let page = initialPage
  const originalLanguage = await page.evaluate(() => window.api.preference.get('app.language'))
  const listChannels = () =>
    page.evaluate(async () => {
      const response = await window.api.dataApi.request({ id: 'mp151-list', method: 'GET', path: '/agent-channels' })
      if (response.status !== 200) throw new Error(`Cannot read channels: ${response.status}`)
      return response.data as AgentChannelEntity[]
    })
  const originalIds = (await listChannels()).map(({ id }) => id)
  const created: AgentChannelEntity[] = []
  const mentionLabel = '仅响应群聊中 @机器人的消息'
  const content = () => page.locator('[data-ui~="settings.content"]')
  const dialog = () => page.getByRole('dialog')
  const mentionSwitch = () => dialog().getByRole('switch', { name: mentionLabel, exact: true })
  const appId = () => dialog().getByPlaceholder('输入你的飞书应用 ID', { exact: true })
  const appSecret = () => dialog().getByPlaceholder('输入你的飞书应用密钥', { exact: true })
  const chatIds = () => dialog().getByPlaceholder('oc_xxxxx，oc_yyyyy', { exact: true })
  const domain = () =>
    dialog()
      .getByRole('combobox')
      .filter({ hasText: /飞书（中国）|飞书（国际版）/ })
  const typeMenu = (label: string) =>
    content()
      .locator('[data-slot="menu-item"]')
      .filter({ has: page.getByText(label, { exact: true }) })
  const screenshot = async (name: string) => {
    await mentionSwitch().scrollIntoViewIfNeeded()
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const openChannels = async () => {
    if (!(await page.locator('[data-ui~="settings.view"]').isVisible())) {
      await expect(page.getByRole('button', { name: '设置', exact: true }).first()).toBeVisible()
      await selectSidebarApp(page, '设置')
    }
    await expect(
      page.locator('[data-ui~="settings.navigation"] [data-slot="menu-item"]').filter({ hasText: '频道' })
    ).toBeVisible()
    await openSettingsSection(page, '频道')
    await expect(page.locator('[data-ui~="settings.navigation"]').getByText('效率', { exact: true })).toBeVisible()
    await expect(content().getByRole('button', { name: '添加', exact: true })).toBeVisible()
  }
  const closeDialog = async () => {
    await dialog().getByRole('button', { name: '关闭', exact: true }).click()
    await expect(dialog()).toBeHidden()
  }
  const row = (name: string) =>
    content()
      .locator('div')
      .filter({ has: page.getByText(name, { exact: true }) })
      .filter({
        has: page.getByRole('button', { name: '编辑', exact: true })
      })
      .last()
  const reopen = async (channel: AgentChannelEntity) => {
    await closeDialog()
    await row(channel.name).getByRole('button', { name: '编辑', exact: true }).click()
    await expect(dialog().getByRole('heading', { name: channel.name, exact: true })).toBeVisible()
  }
  const readConfig = async (channel: AgentChannelEntity) => {
    const saved = (await listChannels()).find(({ id }) => id === channel.id)
    expect(saved, `${channel.name} must still exist`).toBeDefined()
    return saved!.config
  }
  const addChannel = async (type: 'feishu' | 'qq', label: string) => {
    await typeMenu(label).click()
    const before = (await listChannels()).map(({ id }) => id)
    const add = content().getByRole('button', { name: '添加', exact: true })
    expect(await add.innerText()).toBe('添加')
    await add.click()
    await expect(dialog()).toBeVisible()
    const channel = (await listChannels()).find(
      ({ id, type: actualType }) => !before.includes(id) && actualType === type
    )
    expect(channel, 'Add must create a new channel in the real database').toBeDefined()
    created.push(channel!)
    const name = app.resourceName(`${type} ${Date.now()}`)
    await dialog().getByRole('textbox').first().fill(name)
    await dialog().getByRole('textbox').first().blur()
    await expect.poll(async () => (await listChannels()).find(({ id }) => id === channel!.id)?.name).toBe(name)
    channel!.name = name
    return channel!
  }
  const deleteChannel = async (channel: AgentChannelEntity) => {
    await typeMenu(channel.type === 'feishu' ? '飞书' : 'QQ').click()
    await row(channel.name).getByRole('button', { name: '删除', exact: true }).click()
    await expect(dialog()).toContainText(`确定删除频道「${channel.name}」？`)
    await dialog().getByRole('button', { name: '确认', exact: true }).click()
    await expect.poll(async () => (await listChannels()).some(({ id }) => id === channel.id)).toBe(false)
    await expect(content().getByText(channel.name, { exact: true })).toBeHidden()
  }

  testInfo.annotations.push({
    type: 'uncovered',
    description:
      'Real Feishu group-message reception requires real credentials; only local configuration and hint text are covered.'
  })
  await testInfo.attach('MP-151 coverage boundary', {
    body: 'Real Electron UI and database; synthetic credentials only. Real Feishu group-message reception, permission enforcement and @everyone reply suppression are UNCOVERED. The permission and @everyone hint text is asserted. Actual Add button label: 添加.',
    contentType: 'text/plain'
  })
  try {
    await openSettingsSection(page, 'Channels')
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    await openChannels()
    for (const label of ['飞书', 'Telegram', 'QQ', '微信', '企业微信', '钉钉', 'Discord', 'Slack']) {
      await expect(typeMenu(label)).toBeVisible()
    }

    const feishu = await addChannel('feishu', '飞书')
    await expect(mentionSwitch()).toBeChecked()
    await expect(dialog().getByRole('button', { name: /保存|Save/ })).toHaveCount(0)
    await expect(dialog().getByText('允许的聊天 ID', { exact: true })).toBeVisible()
    await expect(chatIds()).toHaveValue('')
    await expect(domain()).toHaveText('飞书（中国）')
    await screenshot('MP-151 Feishu default ON')

    await mentionSwitch().uncheck()
    await expect.poll(() => readConfig(feishu)).toMatchObject({ mention_only: false })
    await reopen(feishu)
    await expect(mentionSwitch()).not.toBeChecked()
    await closeDialog()
    const previousPid = app.record.electronPid
    const previousProfile = app.record.profile
    page = await app.restart()
    expect(app.record.electronPid, 'Restart must launch a new Electron process').not.toBe(previousPid)
    expect(isAlive(previousPid), 'Previous Electron process must fully quit').toBe(false)
    expect(app.record.profile, 'Restart must preserve the isolated profile').toBe(previousProfile)
    await openChannels()
    await row(feishu.name).getByRole('button', { name: '编辑', exact: true }).click()
    await expect(mentionSwitch()).not.toBeChecked()
    await expect.poll(() => readConfig(feishu)).toMatchObject({ mention_only: false })
    await expect(chatIds()).toHaveValue('')
    await expect(domain()).toHaveText('飞书（中国）')
    await screenshot('MP-151 Feishu OFF persisted after full restart')

    await mentionSwitch().check()
    await expect.poll(() => readConfig(feishu)).toMatchObject({ mention_only: true })
    await expect(mentionSwitch()).toBeChecked()
    const hint = dialog().getByText(/关闭后，可接收群聊中未 @机器人的用户消息/)
    await expect(hint).toContainText('获取群组中所有消息（im:message.group_msg）')
    await expect(hint).toContainText('群聊中的 @所有人 消息仍不会触发智能体回复')
    const feishuHint = await hint.innerText()
    await reopen(feishu)
    await expect(mentionSwitch()).toBeChecked()

    for (const field of ['app_id', 'app_secret'] as const) {
      const input = field === 'app_id' ? appId : appSecret
      const first = `mp151-${field}-field-first`
      await input().fill(first)
      await input().blur()
      await mentionSwitch().uncheck()
      await expect.poll(() => readConfig(feishu)).toMatchObject({ [field]: first, mention_only: false })
      await reopen(feishu)
      await expect(input()).toHaveValue(first)
      await expect(mentionSwitch()).not.toBeChecked()

      const second = `mp151-${field}-switch-first`
      await mentionSwitch().check()
      await input().fill(second)
      await input().blur()
      await expect.poll(() => readConfig(feishu)).toMatchObject({ [field]: second, mention_only: true })
      await reopen(feishu)
      await expect(input()).toHaveValue(second)
      await expect(mentionSwitch()).toBeChecked()
    }
    await expect(appId()).toHaveValue('mp151-app_id-switch-first')
    await expect(appSecret()).toHaveValue('mp151-app_secret-switch-first')

    for (const label of ['飞书（国际版）', '飞书（中国）']) {
      await chatIds().fill('oc_mp151_a, oc_mp151_b')
      await chatIds().blur()
      await domain().click()
      await expect(page.getByRole('option', { name: '飞书（中国）', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: '飞书（国际版）', exact: true })).toBeVisible()
      await page.getByRole('option', { name: label, exact: true }).click()
      for (const checked of [false, true]) {
        await mentionSwitch().setChecked(checked)
        await expect
          .poll(() => readConfig(feishu))
          .toMatchObject({
            mention_only: checked,
            allowed_chat_ids: ['oc_mp151_a', 'oc_mp151_b'],
            domain: label === '飞书（中国）' ? 'feishu' : 'lark',
            app_id: 'mp151-app_id-switch-first',
            app_secret: 'mp151-app_secret-switch-first'
          })
        await reopen(feishu)
        await expect(mentionSwitch()).toBeChecked({ checked })
        await expect(chatIds()).toHaveValue('oc_mp151_a, oc_mp151_b')
        await expect(domain()).toHaveText(label)
      }
    }
    await screenshot('MP-151 independent credentials chat IDs and domain')
    await closeDialog()

    const qq = await addChannel('qq', 'QQ')
    await expect(dialog().getByText('仅 @ 消息', { exact: true })).toBeVisible()
    await expect(dialog().getByText(mentionLabel, { exact: true })).toHaveCount(0)
    await expect(dialog().getByRole('switch')).toBeChecked()
    const qqHint = dialog().getByText(
      '开启后机器人只在被 @ 时回复。关闭后可在 QQ 开放平台开启「接收所有消息」，让机器人处理群内每一条消息。',
      { exact: true }
    )
    await expect(qqHint).toBeVisible()
    expect(await qqHint.innerText()).not.toBe(feishuHint)
    await expect(dialog()).not.toContainText('im:message.group_msg')
    await closeDialog()
    for (const checked of [false, true]) {
      await typeMenu('飞书').click()
      await row(feishu.name).getByRole('button', { name: '编辑', exact: true }).click()
      await mentionSwitch().setChecked(checked)
      await expect.poll(() => readConfig(feishu)).toMatchObject({ mention_only: checked })
      await closeDialog()
      await typeMenu('QQ').click()
      await row(qq.name).getByRole('button', { name: '编辑', exact: true }).click()
      await expect(dialog().getByText('仅 @ 消息', { exact: true })).toBeVisible()
      await expect(dialog().getByRole('switch')).toBeChecked()
      await expect(qqHint).toBeVisible()
      await expect.poll(() => readConfig(qq)).toMatchObject({ mention_only: true })
      await closeDialog()
    }
    await typeMenu('飞书').click()
    await row(feishu.name).getByRole('button', { name: '编辑', exact: true }).click()
    await expect(mentionSwitch()).toBeChecked()
    await screenshot('MP-151 Feishu restored ON QQ unaffected')
    await closeDialog()
    for (const channel of created) await deleteChannel(channel)
    expect((await listChannels()).map(({ id }) => id).sort()).toEqual([...originalIds].sort())
  } finally {
    page = await app.mainWindow()
    for (const channel of created) {
      if ((await listChannels()).some(({ id }) => id === channel.id)) {
        await page.evaluate((channelId) => window.api.ipcApi.request('channel.delete', { channelId }), channel.id)
      }
    }
    await expect.poll(async () => (await listChannels()).map(({ id }) => id).sort()).toEqual([...originalIds].sort())
    await page.keyboard.press('Escape')
    await page.evaluate((language) => window.api.preference.set('app.language', language), originalLanguage)
    await expect.poll(() => page.evaluate(() => window.api.preference.get('app.language'))).toBe(originalLanguage)
  }
}
