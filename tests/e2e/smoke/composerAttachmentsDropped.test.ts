import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { _electron as electron, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import type { DataRequest, DataResponse } from '../../../src/shared/data/api/types'
import type { FileRef } from '../../../src/shared/data/types/file'
import type { BranchMessagesResponse } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import type { Topic } from '../../../src/shared/data/types/topic'
import { readCherryMeta } from '../../../src/shared/data/types/uiParts'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, runTest, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: testInfo.outputPath('profile') },
      timeout: 60_000
    })
    try {
      await runTest(app)
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

async function request<T>(page: Page, payload: DataRequest): Promise<DataResponse<T>> {
  return page.evaluate((payload) => window.api.dataApi.request(payload), payload) as Promise<DataResponse<T>>
}

function lastUserText(request: MockChatRequest): string {
  const message = request.body.messages
    .map((message) => message as { role?: string; content?: unknown })
    .filter((message) => message.role === 'user')
    .at(-1)
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

for (const name of ['sample.txt', 'sample.pdf']) {
  test(`Quick Panel ${name} reaches a text-only model and persists its composer attachment`, async ({
    electronApp,
    mainWindow: page
  }, testInfo) => {
    test.setTimeout(180_000)
    const server = await startMockChatServer()
    const providerId = `composer-attachment-${Date.now()}`
    const sentinel = `ATTACHMENT_CONTENT_${name}_${providerId}`
    const prompt = `Summarize the attachment ${name} turn ${providerId}`
    const marker = `ATTACHMENT_OK_${name}_${providerId}`
    const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
    const saveJson = async (name: string, data: unknown) => {
      const filePath = testInfo.outputPath(name)
      await writeFile(filePath, JSON.stringify(data, null, 2))
      await testInfo.attach(name, { path: filePath, contentType: 'application/json' })
    }
    const screenshot = async (name: string) => {
      await page.bringToFront()
      await page.waitForTimeout(250)
      const filePath = testInfo.outputPath(name)
      await page.screenshot({ path: filePath })
      await testInfo.attach(name, { path: filePath, contentType: 'image/png' })
    }

    try {
      const fixtureRoot = testInfo.outputPath('fixtures')
      await mkdir(fixtureRoot, { recursive: true })
      const filePath = path.join(fixtureRoot, name)
      if (name.endsWith('.pdf')) {
        const pdf = await PDFDocument.create()
        pdf.addPage().drawText(sentinel, { x: 20, y: 400, size: 10 })
        await writeFile(filePath, await pdf.save())
      } else {
        await writeFile(filePath, `${sentinel}\n`)
      }
      expect(prompt).not.toContain(sentinel)

      await page.evaluate(async (privacyVersion) => {
        await window.api.preference.set('app.privacy.policy_version', privacyVersion)
        await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
        await window.api.preference.set('app.language', 'en-US')
      }, LATEST_PRIVACY_POLICY_VERSION)
      await page.reload()
      await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 60_000 })
      await selectSidebarApp(page, 'Chat')
      await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))

      const provider = await request(page, {
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          name: 'Composer attachment smoke',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl: server.baseUrl } },
          apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
        }
      })
      expect(provider.status, JSON.stringify(provider)).toBe(201)
      const enabled = await request(page, {
        id: `${providerId}-enable`,
        method: 'PATCH',
        path: `/providers/${providerId}`,
        body: { isEnabled: true }
      })
      expect(enabled.status, JSON.stringify(enabled)).toBe(200)
      const models = await request(page, {
        id: `${providerId}-model`,
        method: 'POST',
        path: '/models',
        body: [{ providerId, modelId: server.modelId, endpointTypes: ['openai-chat-completions'] }]
      })
      expect(models.status, JSON.stringify(models)).toBe(201)
      const assistantName = `Attachment smoke ${providerId}`
      const assistant = await request<{ id: string }>(page, {
        id: `${providerId}-assistant`,
        method: 'POST',
        path: '/assistants',
        body: { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
      })
      expect(assistant.status, JSON.stringify(assistant)).toBe(201)
      expect(assistant.data?.id).toBeTruthy()

      await page.reload()
      const chatView = uiLocator(page, 'chat.view').filter({ visible: true })
      await expect(chatView).toBeVisible()
      const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
      await assistantRow.hover()
      await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)

      const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
      const editor = composer.locator('[contenteditable="true"]').first()
      await editor.fill(prompt)
      try {
        await electronApp.evaluate(({ dialog }, filePath) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
        }, filePath)
        await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
        await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
        await expect(composer.getByText(name, { exact: true })).toBeVisible()
        await screenshot('01-chip.png')
      } finally {
        await electronApp.evaluate(({ dialog }, original) => {
          dialog.showOpenDialog = original
        }, originalDialog)
      }
      await page.getByRole('button', { name: 'Send', exact: true }).click()

      let matched: MockChatRequest | undefined
      const deadline = Date.now() + 30_000
      while (!matched && Date.now() < deadline) {
        const incoming = await server.nextRequest(Math.max(1, deadline - Date.now()))
        if (incoming.body.model === server.modelId && lastUserText(incoming).includes(prompt)) matched = incoming
        else incoming.complete('Background request complete')
      }
      expect(matched, 'The intended Chat turn must reach the provider').toBeDefined()
      await saveJson(`request-${name}.json`, matched!.body)
      const text = lastUserText(matched!)
      expect(text).toContain(prompt)
      expect(text).toContain(`Attached file "${name}":`)
      expect(text).toContain(sentinel)
      expect(text).not.toContain('unsupported file type')
      expect(text).not.toContain('could not read this file')
      matched!.complete(marker)
      await expect(uiLocator(page, 'chat.message').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
      await screenshot('02-after-send.png')

      const topics = await request<{ items: Topic[] }>(page, {
        id: 'attachment-topics',
        method: 'GET',
        path: '/topics'
      })
      await saveJson('topics.json', topics)
      expect(topics.status).toBe(200)
      const topic = topics.data?.items
        .filter((topic) => topic.assistantId === assistant.data!.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      expect(topic, 'A topic for the seeded assistant must be persisted').toBeDefined()
      const messages = await request<BranchMessagesResponse>(page, {
        id: 'attachment-messages',
        method: 'GET',
        path: `/topics/${topic!.id}/messages`
      })
      await saveJson(`messages-${name}.json`, messages)
      expect(messages.status).toBe(200)
      const user = messages.data?.items
        .map(({ message }) => message)
        .find(
          (message) =>
            message.role === 'user' &&
            message.data.parts?.some((part) => part.type === 'text' && part.text.includes(prompt))
        )
      expect(user, 'The matching user turn must be persisted').toBeDefined()
      const parts = user!.data.parts!
      const files = parts.filter((part) => part.type === 'file')
      expect(files).toHaveLength(1)
      expect(files[0].filename).toBe(name)
      const meta = readCherryMeta(files[0])
      expect(meta?.fileEntryId).toBeTruthy()
      expect(meta?.fileTokenSourceId).toBeTruthy()
      const textPart = parts.filter((part) => part.type === 'text').find((part) => part.text.includes(prompt))!
      expect(readCherryMeta(textPart)?.composer?.tokens).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: `file:${meta!.fileTokenSourceId}`, kind: 'file' })])
      )
      const refs = await request<FileRef[]>(page, {
        id: 'attachment-refs',
        method: 'GET',
        path: `/files/entries/${meta!.fileEntryId}/refs`
      })
      await saveJson(`refs-${name}.json`, refs)
      expect(refs.status).toBe(200)
      const attachments = refs.data?.filter((ref) => 'role' in ref && ref.role === 'attachment')
      expect(attachments).toHaveLength(1)
      expect(attachments![0]).toMatchObject({ sourceType: 'chat_message', sourceId: user!.id })
    } finally {
      try {
        await electronApp.evaluate(({ dialog }, original) => {
          dialog.showOpenDialog = original
        }, originalDialog)
      } finally {
        try {
          await originalDialog.dispose()
        } finally {
          await server.close()
        }
      }
    }
  })
}
