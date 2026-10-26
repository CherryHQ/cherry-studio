import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AppInfo } from '@renderer/types/app'
import { AssistantSchema } from '@shared/data/types/assistant'
import { KnowledgeBaseSchema } from '@shared/data/types/knowledge'
import { MessageSchema } from '@shared/data/types/message'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { isPathInside } from '../../../scripts/e2e/regression/paths'
import { assertOwnedProcess, isAlive } from '../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import type { RegressionApp } from './RegressionApp'
import { openSettingsSection } from './settings'

const runFile = promisify(execFile)

async function confirmNativeDialog(app: RegressionApp, name: string): Promise<void> {
  assertOwnedProcess(app.record, app.record.electronPid, 'electron')
  await runFile(
    'osascript',
    [
      '-e',
      `
    tell application "System Events"
      tell (first process whose unix id is ${app.record.electronPid})
        set frontmost to true
        repeat 100 times
          repeat with windowIndex from 1 to count windows
            if exists button "${name}" of window windowIndex then
              click button "${name}" of window windowIndex
              return
            end if
          end repeat
          delay 0.2
        end repeat
        error "Native confirmation button was not found: ${name}"
      end tell
    end tell
  `
    ],
    { timeout: 30_000 }
  )
}

export async function resetAppData(app: RegressionApp, initialPage: Page, testInfo: TestInfo): Promise<void> {
  let page = initialPage
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const info = (await page.evaluate(() => window.api.ipcApi.request('app.get_info'))) as IpcResult<AppInfo>
  expect(info.ok).toBe(true)
  if (!info.ok) throw new Error(info.error.message)
  const userData = info.data.appDataPath
  expect(isPathInside(app.paths.profiles, userData), 'Reset must use a run-owned, isolated profile').toBe(true)
  const fixture = join(app.paths.workspace, 'MP-121-reset-file.txt')
  const markerText = 'MP-121 data must disappear after reset'
  await writeFile(fixture, markerText)
  const seeded = await page.evaluate(
    async ({ fixture, markerText }) => {
      const assistant = await window.api.dataApi.request({
        id: 'mp121-assistant',
        method: 'POST',
        path: '/assistants',
        body: { name: 'MP-121 reset assistant' }
      })
      if (assistant.status !== 201) throw new Error(JSON.stringify(assistant))
      const topic = await window.api.dataApi.request({
        id: 'mp121-topic',
        method: 'POST',
        path: '/topics',
        body: { name: 'MP-121 reset topic', assistantId: (assistant.data as { id: string }).id }
      })
      if (topic.status !== 201) throw new Error(JSON.stringify(topic))
      const message = await window.api.dataApi.request({
        id: 'mp121-message',
        method: 'POST',
        path: `/topics/${(topic.data as { id: string }).id}/messages`,
        body: { role: 'user', data: { parts: [{ type: 'text', text: markerText }] } }
      })
      if (message.status !== 201) throw new Error(JSON.stringify(message))
      const knowledge = await window.api.ipcApi.request('knowledge.create_base', {
        base: { name: 'MP-121 reset knowledge' }
      })
      const file = await window.api.file.createInternalEntry({ source: 'path', path: fixture, cleanupPolicy: 'manual' })
      const filePath = await window.api.file.getPhysicalPath({ id: file.id })
      await window.api.preference.set('topic.naming.enabled', false)
      return { assistant, topic, message, knowledge, file, filePath }
    },
    { fixture: AbsoluteFilePathSchema.parse(fixture), markerText }
  )
  const assistantId = AssistantSchema.parse(seeded.assistant.data).id
  const topicId = TopicSchema.parse(seeded.topic.data).id
  const messageId = MessageSchema.parse(seeded.message.data).id
  const knowledge = seeded.knowledge as IpcResult<unknown>
  expect(knowledge.ok).toBe(true)
  if (!knowledge.ok) throw new Error(knowledge.error.message)
  const knowledgeId = KnowledgeBaseSchema.parse(knowledge.data).id
  expect(await readFile(seeded.filePath, 'utf8')).toBe(markerText)

  // Keep a full profile copy outside the reset target before exercising destructive UI.
  // It contains the live database with real provider keys, so it stays out of the uploaded roots.
  const backup = join(app.paths.private, 'MP-121-profile-backup')
  await cp(userData, backup, { recursive: true })
  expect((await stat(join(backup, 'Data', 'cherrystudio.sqlite'))).size).toBeGreaterThan(0)
  await testInfo.attach('MP-121 isolated profile and backup', {
    body: JSON.stringify({
      userData,
      backup,
      assistantId,
      topicId,
      messageId,
      knowledgeId,
      fileId: seeded.file.id
    }),
    contentType: 'application/json'
  })

  await openSettingsSection(page, 'Data')
  const openConfirmation = async () => {
    await page.locator('#setting-data-data-reset').getByRole('button', { name: 'Reset', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Reset App Data', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('chats, assistants, knowledge bases, files, and settings')
    await expect(dialog).toContainText('restart the app')
    await expect(dialog).toContainText('This action cannot be undone')
    return dialog
  }
  let dialog = await openConfirmation()
  await attachScreenshot('MP-121 reset scope and irreversible warning')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()

  // A directory at the atomic marker destination causes a real staging failure before deletion.
  const marker = join(userData, 'data-reset.pending.json')
  await mkdir(marker)
  try {
    dialog = await openConfirmation()
    await Promise.all([
      dialog.getByRole('button', { name: 'Confirm', exact: true }).click(),
      confirmNativeDialog(app, 'Reset and Restart')
    ])
    await expect(page.getByText('Failed to start data reset', { exact: true })).toBeVisible()
    expect(isAlive(app.record.electronPid)).toBe(true)
    expect(await readFile(seeded.filePath, 'utf8')).toBe(markerText)
    await attachScreenshot('MP-121 real reset failure is reported')
  } finally {
    await rm(marker, { recursive: true, force: true })
  }

  const oldPid = app.record.electronPid
  dialog = await openConfirmation()
  await Promise.all([
    dialog.getByRole('button', { name: 'Confirm', exact: true }).click(),
    confirmNativeDialog(app, 'Reset and Restart')
  ])
  if (app.record.mode === 'branch') await confirmNativeDialog(app, 'OK')
  await expect.poll(() => isAlive(oldPid), { timeout: 60_000 }).toBe(false)
  page = app.record.mode === 'branch' ? await app.restart() : await app.adoptRelaunch()
  expect(app.record.electronPid).not.toBe(oldPid)
  await expect(page.getByRole('button', { name: /Set up later|稍后设置/ })).toBeVisible({ timeout: 60_000 })
  const after = await page.evaluate(
    async ({ assistantId, topicId, messageId, knowledgeId, fileId }) => {
      const responses: { status: number }[] = []
      for (const path of [
        `/assistants/${assistantId}`,
        `/topics/${topicId}`,
        `/messages/${messageId}`,
        `/knowledge-bases/${knowledgeId}`,
        `/files/entries/${fileId}`
      ]) {
        responses.push(await window.api.dataApi.request({ id: `mp121-check-${path}`, method: 'GET', path }))
      }
      return {
        responses,
        naming: await window.api.preference.get('topic.naming.enabled'),
        onboarding: await window.api.preference.get('app.onboarding.provider_setup.status')
      }
    },
    { assistantId, topicId, messageId, knowledgeId, fileId: seeded.file.id }
  )
  expect(after.responses.map(({ status }) => status)).toEqual([404, 404, 404, 404, 404])
  expect(after.naming).toBe(true)
  expect(after.onboarding).toBe('pending')
  await expect(stat(seeded.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  await attachScreenshot('MP-121 first launch onboarding after complete reset')
  await testInfo.attach('MP-121 reset verification', { body: JSON.stringify(after), contentType: 'application/json' })
}
