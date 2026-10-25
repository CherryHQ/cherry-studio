import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AppInfo } from '@renderer/types/app'
import { AssistantSchema } from '@shared/data/types/assistant'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

// Catch incorrect date/assistant buckets, disappearing headers on collapse, and lost display preferences on restart.
export async function topicGrouping(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const originalMode = await page.evaluate(() => window.api.preference.get('topic.tab.display_mode'))
  const assistantIds: string[] = []
  const topics: Array<{ id: string; name: string; daysAgo: number }> = []
  const assistantNames = [app.resourceName('Grouping A'), app.resourceName('Grouping B')]
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = () => page.locator('[data-ui~="chat.view"]:visible')
  const header = (name: string) => chat().locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
  const row = (name: string) => chat().getByTestId('topic-list-row').filter({ hasText: name })
  const setMode = async (name: 'Time' | 'Assistant') => {
    await chat().getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
  }
  const expand = async (name: string) => {
    const group = header(name)
    await expect(group).toBeVisible()
    await group.hover()
    const button = group.locator('button[aria-expanded="false"]:not([aria-label="More"])')
    if (await button.count()) await button.click()
  }
  const displayedGroups = () =>
    chat().evaluate(
      (element, labels) => {
        const groups: Record<string, string[]> = {}
        let current = ''
        for (const item of element.querySelectorAll('[data-ui~="chat.group-header"], [data-testid="topic-list-row"]')) {
          if (item.matches('[data-ui~="chat.group-header"]')) {
            current = labels.find((label) => item.textContent?.includes(label)) ?? ''
            groups[current] = []
          } else if (current) {
            groups[current].push(item.getAttribute('data-topic-id') ?? item.textContent?.trim() ?? '')
          }
        }
        return groups
      },
      ['Today', 'Yesterday', 'Earlier', ...assistantNames, 'Unlinked Assistant']
    )

  try {
    for (const name of assistantNames) {
      const response = await page.evaluate(
        (name) =>
          window.api.dataApi.request({
            id: 'mp45-assistant',
            method: 'POST',
            path: '/assistants',
            body: { name }
          }),
        name
      )
      expect(response.status).toBe(201)
      assistantIds.push(AssistantSchema.parse(response.data).id)
    }
    for (const [index, daysAgo] of [0, 0, 1, 14, 14].entries()) {
      const name = app.resourceName(`Grouping topic ${index + 1}`)
      const response = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp45-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name, assistantId: index < 2 ? assistantIds[0] : index < 4 ? assistantIds[1] : undefined }
      )
      expect(response.status).toBe(201)
      topics.push({ id: TopicSchema.parse(response.data).id, name, daysAgo })
    }

    // Topic timestamps are read-only in DataApi; seed only these run-owned rows in the real database.
    // Branch launches relocate userData beneath the dev profile root, so ask the app where its data lives.
    const appInfo = (await page.evaluate(() => window.api.ipcApi.request('app.get_info'))) as IpcResult<AppInfo>
    expect(appInfo.ok).toBe(true)
    if (!appInfo.ok) throw new Error(appInfo.error.message)
    const databasePath = join(appInfo.data.appDataPath, 'Data', 'cherrystudio.sqlite')
    expect(existsSync(databasePath), `Run-owned database must exist at ${databasePath}`).toBe(true)
    const db = new DatabaseSync(databasePath)
    try {
      const update = db.prepare('UPDATE topic SET last_activity_at = ?, created_at = ?, updated_at = ? WHERE id = ?')
      for (const topic of topics) {
        const date = new Date()
        date.setDate(date.getDate() - topic.daysAgo)
        date.setHours(12, 0, 0, 0)
        expect(update.run(date.getTime(), date.getTime(), date.getTime(), topic.id).changes).toBe(1)
      }
    } finally {
      db.close()
    }
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await setMode('Time')
    for (const name of ['Today', 'Yesterday', 'Earlier']) await expand(name)
    for (const topic of topics) await expect(row(topic.name)).toBeVisible()

    const timeGroups = await displayedGroups()
    const owned = (values: string[]) =>
      values.filter((value) => topics.some((topic) => value.includes(topic.id) || value.includes(topic.name)))
    for (const [name, daysAgo, count] of [
      ['Today', 0, 2],
      ['Yesterday', 1, 1],
      ['Earlier', 14, 2]
    ] as const) {
      expect(timeGroups[name], `${name} must contain exactly its seeded topics`).toBeDefined()
      expect(owned(timeGroups[name]), `${name} must contain exactly its seeded topics`).toHaveLength(count)
      const members = topics.filter((topic) => topic.daysAgo === daysAgo)
      expect(
        timeGroups[name].filter((value) =>
          members.some((topic) => value.includes(topic.id) || value.includes(topic.name))
        )
      ).toHaveLength(count)
      for (const topic of topics.filter((topic) => topic.daysAgo !== daysAgo)) {
        expect(timeGroups[name].some((value) => value.includes(topic.id) || value.includes(topic.name))).toBe(false)
      }
    }
    await screenshot('MP-45 time groups expanded')
    await header('Earlier').locator('button[aria-expanded="true"]').click()
    await expect(header('Earlier')).toBeVisible()
    for (const topic of topics.filter((topic) => topic.daysAgo === 14)) await expect(row(topic.name)).toBeHidden()
    await expect(row(topics[2].name)).toBeVisible()
    await screenshot('MP-45 earlier group collapsed')
    await expand('Earlier')
    for (const topic of topics.filter((topic) => topic.daysAgo === 14)) await expect(row(topic.name)).toBeVisible()

    await setMode('Assistant')
    const verifyAssistantGroups = async () => {
      for (const name of [...assistantNames, 'Unlinked Assistant']) await expand(name)
      for (const topic of topics) await expect(row(topic.name)).toBeVisible()
      const groups = await displayedGroups()
      for (const [name, members] of [
        [assistantNames[0], topics.slice(0, 2)],
        [assistantNames[1], topics.slice(2, 4)],
        ['Unlinked Assistant', topics.slice(4)]
      ] as const) {
        expect(groups[name]).toBeDefined()
        expect(groups[name]).toHaveLength(members.length)
        for (const topic of members)
          expect(groups[name].some((value) => value.includes(topic.id) || value.includes(topic.name))).toBe(true)
        expect(
          groups[name].filter((value) => topics.some((topic) => value.includes(topic.id) || value.includes(topic.name)))
        ).toHaveLength(members.length)
      }
      for (const name of ['Today', 'Yesterday', 'Earlier']) await expect(header(name)).toBeHidden()
    }
    await verifyAssistantGroups()
    await expect.poll(() => page.evaluate(() => window.api.preference.get('topic.tab.display_mode'))).toBe('assistant')
    await screenshot('MP-45 assistant groups')
    page = await app.restart()
    await selectSidebarApp(page, 'Chat')
    expect(await page.evaluate(() => window.api.preference.get('topic.tab.display_mode'))).toBe('assistant')
    await verifyAssistantGroups()
    await screenshot('MP-45 assistant groups after restart')
  } finally {
    page = await app.mainWindow()
    await page.evaluate(
      async ({ originalMode, topicIds, assistantIds }) => {
        await window.api.preference.set('topic.tab.display_mode', originalMode)
        if (topicIds.length) {
          await window.api.ipcApi.request('trash.topic.archive', { topicIds })
          await window.api.ipcApi.request('trash.topic.delete_permanently', { topicIds })
        }
        for (const assistantId of assistantIds) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
      },
      { originalMode, topicIds: topics.map(({ id }) => id), assistantIds }
    )
  }
}
