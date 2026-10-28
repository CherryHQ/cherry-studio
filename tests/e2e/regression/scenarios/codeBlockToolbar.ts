import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { saveNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function codeBlockToolbar(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    wrappable: await window.api.preference.get('chat.code.wrappable'),
    collapsible: await window.api.preference.get('chat.code.collapsible'),
    editorEnabled: await window.api.preference.get('chat.code.editor.enabled'),
    executionEnabled: await window.api.preference.get('chat.code.execution.enabled')
  }))
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `regression-mp40-${Date.now()}`
  const topicName = app.resourceName('Code toolbar')
  const assistantName = app.resourceName('Code toolbar assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'chat.code.wrappable': true,
        'chat.code.collapsible': true,
        'chat.code.editor.enabled': true,
        'chat.code.execution.enabled': true
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Code toolbar mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp40-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp40-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    TopicSchema.parse(topic.data)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chat).toBeVisible({ timeout: 30_000 })
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible({ timeout: 30_000 })
    await assistantRow.hover()
    const expandButton = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
    const topicRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await expect(topicRow).toBeVisible({ timeout: 30_000 })
    await topicRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const code = [
      'def greet(name):',
      '    if name:',
      '        return f"Hello, {name}!"',
      '    return "Hello!"',
      `description = "${'MP40 long line with preserved indentation. '.repeat(12)}"`,
      ...Array.from({ length: 60 }, (_, index) => `# MP40 preview line ${index + 1}`),
      'print(greet("MP40"))'
    ].join('\n')
    const prompt = 'Output a Python code block with an indented function, a long line and comments.'
    // Mock only the provider response; all toolbar effects use the real Electron application.
    const [messageId] = await Promise.all([
      sendChatMarker(page, prompt, 'MP40 Python fixture.'),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        expect(request.body.messages).toContainEqual(expect.objectContaining({ role: 'user', content: prompt }))
        request.complete(`MP40 Python fixture.\n\n\`\`\`python\n${code}\n\`\`\``)
      })()
    ])
    const block = page.locator(`[data-message-id="${messageId}"] [data-ui~="part:code-block"]`)
    await expect(block).toHaveCount(1)
    await block.hover()
    const more = block.getByRole('button', { name: 'More', exact: true })
    if (await more.isVisible()) await more.click()
    await block.getByRole('button', { name: 'Copy Source Code', exact: true }).click()
    await expect
      .poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
      .toBe(code)
    await attachScreenshot('MP-40 Python code copied with indentation')

    const output = join(app.paths.evidence, `MP40-code-${Date.now()}.py`)
    await block.getByRole('button', { name: 'Download Source Code', exact: true }).click()
    if (app.record.platform === 'macos') {
      await mkdir(dirname(output), { recursive: true })
      const suggestedName = execFileSync(
        'osascript',
        [
          '-e',
          [
            'on run argv',
            'tell application "System Events"',
            'tell (first application process whose unix id is (item 3 of argv as integer))',
            'set frontmost to true',
            'delay 1',
            'set suggestedName to ""',
            'repeat with saveElement in entire contents of window 1',
            'if class of saveElement is text field then',
            'set candidateName to value of saveElement as text',
            'if candidateName ends with ".py" then set suggestedName to candidateName',
            'end if',
            'end repeat',
            'if suggestedName is "" then error "Save dialog has no suggested .py filename"',
            'keystroke "g" using {command down, shift down}',
            'delay 1',
            'keystroke (item 1 of argv)',
            'key code 36',
            'delay 1',
            'keystroke "a" using command down',
            'keystroke (item 2 of argv)',
            'key code 36',
            'return suggestedName',
            'end tell',
            'end tell',
            'end run'
          ].join('\n'),
          '--',
          dirname(output),
          basename(output),
          String(app.record.electronPid)
        ],
        { encoding: 'utf8', timeout: 15_000 }
      ).trim()
      expect(extname(suggestedName)).toBe('.py')
    } else {
      await saveNativeFile(app.record.platform, app.paths, output)
    }
    await expect.poll(() => readFile(output, 'utf8').catch(() => null)).toBe(`${code}\n`)
    await testInfo.attach('MP-40 downloaded Python source', { path: output, contentType: 'text/x-python' })

    const viewer = block.locator('.shiki-scroller')
    await expect(viewer).toBeVisible()
    await block.getByRole('button', { name: 'Unwrap', exact: true }).click()
    const longLine = block.locator('[data-index="4"]')
    const unwrappedHeight = await longLine.evaluate((element) => element.getBoundingClientRect().height)
    expect(await viewer.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await block.getByRole('button', { name: 'Wrap', exact: true }).click()
    await expect
      .poll(() => longLine.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThan(unwrappedHeight)
    await expect.poll(() => viewer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

    await block.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(block.locator('.cm-editor')).toBeVisible()
    await block.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(viewer).toBeVisible()
    expect(await viewer.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await viewer.hover()
    await page.mouse.wheel(0, 600)
    await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await attachScreenshot('MP-40 scrollable Python preview')

    await block.hover()
    const run = block.getByRole('button', { name: 'Run', exact: true })
    if (await run.isVisible()) {
      await run.click()
      await expect(block.getByText(/Hello, MP40!|Unexpected error:|Error:|Traceback/).last()).toBeVisible({
        timeout: 90_000
      })
      await attachScreenshot('MP-40 Python execution result')
    }
    await block.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(viewer).toBeHidden()
    await expect(block.locator('.cm-editor')).toBeVisible()
    const composer = chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    await composer.fill('MP40 interface remains responsive')
    await expect(composer).toContainText('MP40 interface remains responsive')
    await composer.fill('')
    await attachScreenshot('MP-40 preview closed and responsive composer')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'chat.code.wrappable': preferences.wrappable,
          'chat.code.collapsible': preferences.collapsible,
          'chat.code.editor.enabled': preferences.editorEnabled,
          'chat.code.execution.enabled': preferences.executionEnabled
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({
          id: `${providerId}-delete`,
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, preferences }
    )
  }
}
