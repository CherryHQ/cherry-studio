import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

import type { AppInfo } from '@renderer/types/app'
import { AssistantSchema } from '@shared/data/types/assistant'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import { revealVirtualized } from '../helpers/virtualList'
import type { RegressionApp } from '../RegressionApp'

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
  const groupLabels = ['Today', 'Yesterday', 'Earlier', ...assistantNames, 'Unlinked Assistant']
  // Both the row set and the group headers live in one virtualized list: rows below the window are
  // not mounted, and a header scrolls away from rows deeper inside its own group.
  const scroller = () => chat().locator('[data-virtual-scrolling]').first()
  const reveal = async (target: Locator) => {
    if ((await target.count()) > 0 && (await target.first().isVisible())) return
    await revealVirtualized(page, scroller(), target)
  }
  const expand = async (name: string) => {
    await reveal(header(name))
    const group = header(name)
    await expect(group, `${name} group header must be reachable`).toBeVisible()
    await group.hover()
    const button = group.locator('button[aria-expanded="false"]:not([aria-label="More"])')
    if (await button.count()) await button.click()
  }
  const showAllRows = async () => {
    for (let step = 0; step < 10; step += 1) {
      const more = chat().locator('button:visible').filter({ hasText: 'Show more' })
      if ((await more.count()) === 0) return
      await more.first().click()
      await page.waitForTimeout(150)
    }
  }
  // Walk the list from the group's own header to the next known header, keeping the rows of this
  // group out of every window it renders on the way.
  const groupRows = async (name: string): Promise<string[]> => {
    await reveal(header(name))
    const list = scroller()
    const rows: string[] = []
    let inside = false
    for (let step = 0; step < 80; step += 1) {
      const items = await list.evaluate((element) => {
        const labelOf = (item: Element) => {
          for (const span of item.querySelectorAll('span')) {
            const text = (span.textContent ?? '').trim()
            if (text) return text
          }
          return (item.textContent ?? '').trim()
        }
        const sequence: Array<{ kind: 'header'; label: string } | { kind: 'row'; value: string }> = []
        for (const item of element.querySelectorAll('[data-ui~="chat.group-header"], [data-testid="topic-list-row"]')) {
          sequence.push(
            item.matches('[data-ui~="chat.group-header"]')
              ? { kind: 'header', label: labelOf(item) }
              : { kind: 'row', value: item.getAttribute('data-topic-id') ?? (item.textContent ?? '').trim() }
          )
        }
        return sequence
      })
      let ended = false
      for (const item of items) {
        if (item.kind === 'header') {
          const label = groupLabels.find((candidate) => item.label === candidate)
          if (!label) continue
          if (inside && label !== name) {
            ended = true
            break
          }
          if (label === name) inside = true
        } else if (inside) {
          // The list is virtualized and overscans: one topic can be rendered in several windows,
          // so keep the first sighting only. Duplicates would inflate the membership count.
          if (!rows.includes(item.value)) rows.push(item.value)
        }
      }
      if (ended) break
      const moved = await list.evaluate((element) => {
        const next = Math.min(element.scrollTop + element.clientHeight * 0.8, element.scrollHeight)
        if (next <= element.scrollTop) return false
        element.scrollTop = next
        return true
      })
      if (!moved) break
      await page.waitForTimeout(200)
    }
    return rows
  }
  const ownedIn = (values: string[]) =>
    values.filter((value) => topics.some((topic) => value.includes(topic.id) || value.includes(topic.name)))

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
    await showAllRows()
    for (const [name, daysAgo, count] of [
      ['Today', 0, 2],
      ['Yesterday', 1, 1],
      ['Earlier', 14, 2]
    ] as const) {
      await expand(name)
      const rendered = ownedIn(await groupRows(name))
      expect(rendered, `${name} must contain exactly its seeded topics`).toHaveLength(count)
      const members = topics.filter((topic) => topic.daysAgo === daysAgo)
      for (const topic of members) {
        expect(
          rendered.some((value) => value.includes(topic.id) || value.includes(topic.name)),
          `${name} must list ${topic.name}`
        ).toBe(true)
      }
      for (const topic of topics.filter((topic) => topic.daysAgo !== daysAgo)) {
        expect(
          rendered.some((value) => value.includes(topic.id) || value.includes(topic.name)),
          `${name} must not list ${topic.name}`
        ).toBe(false)
      }
    }
    await screenshot('MP-45 time groups expanded')
    await reveal(header('Earlier'))
    await header('Earlier').locator('button[aria-expanded="true"]').click()
    await expect(header('Earlier')).toBeVisible()
    for (const topic of topics.filter((topic) => topic.daysAgo === 14)) await expect(row(topic.name)).toHaveCount(0)
    await reveal(row(topics[2].name))
    await expect(row(topics[2].name)).toBeVisible()
    await screenshot('MP-45 earlier group collapsed')
    await expand('Earlier')
    for (const topic of topics.filter((topic) => topic.daysAgo === 14)) {
      await reveal(row(topic.name))
      await expect(row(topic.name)).toBeVisible()
    }

    await setMode('Assistant')
    const verifyAssistantGroups = async () => {
      await showAllRows()
      for (const [name, members] of [
        [assistantNames[0], topics.slice(0, 2)],
        [assistantNames[1], topics.slice(2, 4)],
        ['Unlinked Assistant', topics.slice(4)]
      ] as const) {
        await expand(name)
        // The unlinked bucket also holds conversations this run did not create, so count only case-owned rows.
        const rendered = ownedIn(await groupRows(name))
        expect(rendered, `${name} must contain exactly its seeded topics`).toHaveLength(members.length)
        for (const topic of members) {
          expect(
            rendered.some((value) => value.includes(topic.id) || value.includes(topic.name)),
            `${name} must list ${topic.name}`
          ).toBe(true)
        }
        for (const topic of topics.filter((candidate) => !members.includes(candidate))) {
          expect(
            rendered.some((value) => value.includes(topic.id) || value.includes(topic.name)),
            `${name} must not contain ${topic.name}`
          ).toBe(false)
        }
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
          const permanentlyDeletedTopics = (await window.api.ipcApi.request('trash.topic.delete_permanently', {
            topicIds
          })) as IpcResult<{ deletedCount: number }>
          if (!permanentlyDeletedTopics.ok || permanentlyDeletedTopics.data.deletedCount !== new Set(topicIds).size)
            throw new Error('cleanup left case topics in the trash')
        }
        for (const assistantId of assistantIds) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
      },
      { originalMode, topicIds: topics.map(({ id }) => id), assistantIds }
    )
  }
}
