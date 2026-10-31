import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import iconv from 'iconv-lite'

import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const LRMX_UTF8 = `<?xml version="1.0" encoding="UTF-8"?>
<GanBuRenMianShenPiBiao>
  <XingMing>张三</XingMing>
  <XingBie>男</XingBie>
  <ChuShengNianYue>1975.04</ChuShengNianYue>
  <MinZu>汉族</MinZu>
  <JiGuan>河北石家庄</JiGuan>
  <XianRenZhiWu>某某市某某区人民政府副区长</XianRenZhiWu>
  <NiRenZhiWu>某某市人民政府副市长</NiRenZhiWu>
</GanBuRenMianShenPiBiao>
`
const LRM_GBK = LRMX_UTF8.replace('encoding="UTF-8"', 'encoding="GBK"')
const SENTINEL = '<XianRenZhiWu>某某市某某区人民政府副区长</XianRenZhiWu>'

test('normal Chat content-sniffs unknown text attachments and rejects unknown binary attachments', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  const server = await startMockChatServer()
  const providerId = `attachment-smoke-${Date.now()}`
  const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)

  try {
    expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
    const fixtureRoot = testInfo.outputPath('fixtures')
    await mkdir(fixtureRoot, { recursive: true })
    const fixtures = [
      { name: 'sample.lrmx', encoding: 'UTF-8', content: Buffer.from(LRMX_UTF8), text: LRMX_UTF8 },
      { name: 'sample.lrm', encoding: 'GBK', content: iconv.encode(LRM_GBK, 'gbk'), text: LRM_GBK },
      {
        name: 'binary.onnx',
        encoding: 'binary',
        content: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) % 256)),
        text: null
      }
    ]
    for (const fixture of fixtures) await writeFile(path.join(fixtureRoot, fixture.name), fixture.content)
    const evidence = testInfo.outputPath('fixtures.json')
    await writeFile(
      evidence,
      JSON.stringify(
        fixtures.map(({ name, encoding, content }) => ({
          name,
          encoding,
          bytes: content.byteLength,
          sha256: createHash('sha256').update(content).digest('hex')
        })),
        null,
        2
      )
    )
    await testInfo.attach('fixtures', { path: evidence, contentType: 'application/json' })
    expect(fixtures[0].content.byteLength).toBe(378)
    expect(fixtures[1].content.byteLength).toBe(343)

    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await selectSidebarApp(page, 'Chat')
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Attachment smoke mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
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
    const assistantName = `Attachment smoke ${providerId}`
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'attachment-smoke-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    await page.reload()
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chatView).toBeVisible()
    const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)

    const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
    const editor = composer.locator('[contenteditable="true"]').first()

    for (const fixture of fixtures) {
      await test.step(fixture.name, async () => {
        const prompt = `Attachment smoke ${fixture.name} ${providerId}`
        await editor.fill(prompt)
        try {
          await electronApp.evaluate(
            ({ dialog }, filePath) => {
              dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
            },
            path.join(fixtureRoot, fixture.name)
          )
          const launcher = composer.getByRole('button', { name: 'Upload attachment', exact: true })
          const direct = await launcher.isVisible()
          await testInfo.attach(`launcher-${fixture.name}`, {
            body: direct ? 'Upload attachment chip' : 'Input Quick Panel fallback',
            contentType: 'text/plain'
          })
          if (direct) {
            await launcher.click()
          } else {
            await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
            await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
          }
          if (fixture.text === null) {
            await expect(page.getByText('1 files are not supported', { exact: true })).toBeVisible()
            await expect(composer.getByText(fixture.name, { exact: true })).toHaveCount(0)
            await expect(editor).toHaveText(prompt)
            return
          }
          await expect(composer.getByText(fixture.name, { exact: true })).toBeVisible()
        } finally {
          await electronApp.evaluate(({ dialog }, original) => {
            dialog.showOpenDialog = original
          }, originalDialog)
        }

        await page.getByRole('button', { name: 'Send', exact: true }).click()
        let matched: MockChatRequest | undefined
        let incomingText = ''
        const deadline = Date.now() + 30_000
        while (!matched && Date.now() < deadline) {
          const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
          const userMessage = request.body.messages
            .map((message) => message as { role?: string; content?: unknown })
            .filter((message) => message.role === 'user')
            .at(-1)
          const content = userMessage?.content
          incomingText =
            typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content
                    .filter((part): part is { type: 'text'; text: string } =>
                      Boolean(part && part.type === 'text' && typeof part.text === 'string')
                    )
                    .map((part) => part.text)
                    .join('\n')
                : ''
          if (request.body.model === server.modelId && incomingText.includes(prompt)) matched = request
          else request.complete('Background request complete')
        }
        expect(matched, 'The intended Chat message must reach the mock provider').toBeDefined()
        const requestPath = testInfo.outputPath(
          fixture.name === 'sample.lrmx' ? 'request-pre.json' : 'request-gbk-pre.json'
        )
        await writeFile(requestPath, JSON.stringify(matched!.body, null, 2))
        await testInfo.attach(`request-${fixture.name}`, { path: requestPath, contentType: 'application/json' })
        expect(incomingText).toContain(fixture.name)
        expect(incomingText).toContain(fixture.text!.trim())
        expect(incomingText).toContain(SENTINEL)
        expect(incomingText).not.toContain('unsupported file type')

        const verifiedXml = incomingText.slice(
          incomingText.indexOf('<XianRenZhiWu>'),
          incomingText.indexOf('</XianRenZhiWu>') + '</XianRenZhiWu>'.length
        )
        const marker = `ATTACHMENT_OK_${fixture.name}_${providerId}`
        matched!.complete(`${marker}\n\n\`\`\`xml\n${verifiedXml}\n\`\`\``)
        const reply = uiLocator(page, 'chat.message').filter({ hasText: marker })
        await expect(reply).toBeVisible({ timeout: 30_000 })
        await expect(reply).toContainText(SENTINEL)
        await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
        const screenshot = testInfo.outputPath(
          fixture.name === 'sample.lrmx' ? 'attachment-content-sniff.png' : 'attachment-content-sniff-gbk.png'
        )
        await page.screenshot({ path: screenshot })
        await testInfo.attach(`attachment-content-sniff-${fixture.name}`, {
          path: screenshot,
          contentType: 'image/png'
        })
      })
    }
  } catch (error) {
    const screenshot = testInfo.outputPath('attachment-content-sniff-failure.png')
    await page.screenshot({ path: screenshot })
    await testInfo.attach('attachment-content-sniff-failure', { path: screenshot, contentType: 'image/png' })
    throw error
  } finally {
    try {
      await electronApp.evaluate(({ dialog }, original) => {
        dialog.showOpenDialog = original
      }, originalDialog)
    } finally {
      await server.close()
      await originalDialog.dispose()
    }
  }
})
