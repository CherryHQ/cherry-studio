import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { AssistantSchema } from '../../../../src/shared/data/types/assistant'
import { createUniqueModelId } from '../../../../src/shared/data/types/model'
import { TopicSchema } from '../../../../src/shared/data/types/topic'
import { startMcpImportServer } from '../fixtures/mcpImportServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function importMcpServer(app: RegressionApp, page: Page, testInfo: TestInfo) {
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies and MCP tool server; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const fixture = await startMcpImportServer()
  const name = app.resourceName(`JSON MCP ${Date.now()}`)
  const providerId = `mp134-${Date.now()}`
  let serverId: string | undefined
  let assistantId: string | undefined
  const naming = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const servers = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp134-list', method: 'GET', path: '/mcp-servers' })
    )
    expect(response.status).toBe(200)
    return (response.data as { items: { id: string; name: string; isActive: boolean }[] }).items.filter(
      (item) => item.name === name
    )
  }
  const openImport = async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByText('Import from JSON', { exact: true }).click()
    return page.getByRole('dialog', { name: 'Import from JSON', exact: true })
  }
  const config = JSON.stringify({ mcpServers: { [name]: { type: 'streamableHttp', url: `${fixture.url}/mcp` } } })
  try {
    await openSettingsSection(page, 'MCP')
    const dialog = await openImport()
    const editor = dialog.locator('[contenteditable="true"]')
    await editor.fill('{"mcpServers":')
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(dialog.getByText('Invalid input, please check JSON format', { exact: true })).toBeVisible()
    expect(await servers()).toEqual([])
    await screenshot('MP-134 invalid JSON rejected')
    await editor.fill(config)
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await servers()).length).toBe(1)
    serverId = (await servers())[0].id
    const card = page.locator('[data-slot="mcp-server-row"]').filter({ hasText: name })
    await expect(card).toBeVisible()
    await expect(card.getByRole('switch')).toBeChecked()
    await screenshot('MP-134 imported server card')
    const duplicate = await openImport()
    await duplicate.locator('[contenteditable="true"]').fill(config)
    await duplicate.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(duplicate.getByText(`Server already exists: ${name}`, { exact: true })).toBeVisible()
    expect(await servers()).toHaveLength(1)
    await duplicate.getByRole('button', { name: 'Cancel', exact: true }).click()
    await card.click()
    await expect(page.getByText('Connected', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Tools (1)', exact: true }).click()
    await expect(page.getByText('mp134_echo', { exact: true })).toBeVisible()
    await screenshot('MP-134 connected with one tool')
    const toggle = page.getByRole('switch').first()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Tools/ })).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(page.getByText('Connected', { exact: true })).toBeVisible()

    const seeded = await page.evaluate(
      async ({ providerId, url }) => {
        await window.api.preference.set('topic.naming.enabled', false)
        const provider = await window.api.dataApi.request({
          id: 'mp134-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP134 mock chat',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: `${url}/v1` } },
            apiKeys: [{ id: 'mock', key: 'mock', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp134-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp134-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: 'mp134-chat',
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['function-call']
            }
          ]
        })
        return { provider, enabled, models }
      },
      { providerId, url: fixture.url }
    )
    expect(seeded.provider.status).toBe(201)
    expect(seeded.enabled.status).toBe(200)
    expect(seeded.models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId, serverId }) =>
        window.api.dataApi.request({
          id: 'mp134-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId, mcpServerIds: [serverId] }
        }),
      { name, modelId: createUniqueModelId(providerId, 'mp134-chat'), serverId }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({ id: 'mp134-topic', method: 'POST', path: '/topics', body: { name, assistantId } }),
      { name, assistantId }
    )
    expect(topic.status).toBe(201)
    TopicSchema.parse(topic.data)
    const openChat = async () => {
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      const group = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
      await expect(group).toBeVisible()
      await group.hover()
      const expand = group.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible()) await expand.click()
      await page.getByTestId('topic-list-row').filter({ hasText: name }).click()
    }
    await openChat()
    await Promise.all([
      sendChatMarker(page, 'Use the MCP echo tool.', `MCP returned ${fixture.marker}`),
      (async () => {
        await expect.poll(() => fixture.chats.length, { timeout: 10000 }).toBeGreaterThan(0)
        expect(fixture.chats[0].tools?.map((tool) => tool.function.name)).toEqual(
          expect.arrayContaining([expect.stringMatching(/__mp134Echo_[a-f0-9]{20}$/)])
        )
      })()
    ])
    expect(fixture.calls).toEqual([fixture.marker])
    expect(
      fixture.chats.some((chat) =>
        chat.messages.some(
          (message) => message.role === 'tool' && JSON.stringify(message.content).includes(fixture.marker)
        )
      )
    ).toBe(true)
    await screenshot('MP-134 enabled tool executed')

    await openSettingsSection(page, 'MCP')
    await page.locator('[data-slot="mcp-server-row"]').filter({ hasText: name }).click()
    await page.getByRole('switch').first().click()
    await expect(page.getByRole('switch').first()).not.toBeChecked()
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible()
    await openChat()
    await sendChatMarker(page, 'Is the MCP echo tool available now?', 'MCP unavailable')
    expect(fixture.chats.at(-1)?.tools?.some((tool) => tool.function.name.includes('__mp134Echo_')) ?? false).toBe(
      false
    )
    expect(fixture.calls).toEqual([fixture.marker])

    page = await app.restart()
    await openSettingsSection(page, 'MCP')
    const restartedCard = page.locator('[data-slot="mcp-server-row"]').filter({ hasText: name })
    await expect(restartedCard).toBeVisible()
    await expect(restartedCard.getByRole('switch')).not.toBeChecked()
    expect(await servers()).toEqual([expect.objectContaining({ id: serverId, isActive: false })])
    await restartedCard.click()
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Tools/ })).toHaveCount(0)
    await screenshot('MP-134 disabled state persisted after restart')
  } finally {
    await page.evaluate(
      async ({ assistantId, serverId, providerId, naming }) => {
        await window.api.preference.set('topic.naming.enabled', naming)
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        if (serverId) await window.api.ipcApi.request('mcp.server.remove', { serverId })
        await window.api.dataApi.request({ id: 'mp134-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, serverId, providerId, naming }
    )
    await fixture.close()
  }
}
