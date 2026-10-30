import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { _electron as electron, type Page } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'

const TOPIC = 'Archive entry refresh regression'
const ASSISTANT = 'Archive refresh assistant'
const labels = {
  settings: /^(设置|Settings)$/,
  archive: /^(归档|Archive)$/,
  all: /^(全部|All)$/,
  topics: /^(话题|Topics)$/,
  later: /^(稍后设置|Set up later)$/,
  empty: /^(暂无已归档的项目|No archived items)$/,
  back: /^(返回|Back)$/
}
const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const profile = testInfo.outputPath('profile')
    await mkdir(profile, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
    delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({
      args: ['.'],
      env: Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined)),
      timeout: 60_000
    })
    try {
      await provideApp(app)
    } finally {
      await app.close()
    }
  }
})

async function openArchive(page: Page) {
  await page.getByRole('button', { name: labels.settings }).first().click({ noWaitAfter: true })
  await page.locator('[data-ui~="settings.navigation"]').getByRole('button', { name: labels.archive }).click()
  await expect(page.getByRole('tab', { name: labels.all })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: labels.topics })).toBeVisible()
}

test('All re-reads after archiving through the topic context menu inside the dedupe window', async ({
  mainWindow: page
}, testInfo) => {
  await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
  await expect
    .poll(
      async () => {
        if (await page.locator('[data-ui~="app.content"]').count()) return 'ready'
        const later = page.getByRole('button', { name: labels.later })
        if (await later.isVisible()) await later.click({ noWaitAfter: true, timeout: 1000 }).catch(() => undefined)
        return 'waiting'
      },
      { timeout: 60_000, intervals: [100, 250, 500, 1000] }
    )
    .toBe('ready')
  const seeded = await page.evaluate(
    async ({ assistantName, topicName }) => {
      const assistant = await window.api.dataApi.request({
        id: 'archive-diag-seed-assistant',
        method: 'POST',
        path: '/assistants',
        body: { name: assistantName }
      })
      const assistantId = (assistant.data as { id: string }).id
      const topic = await window.api.dataApi.request({
        id: 'archive-diag-seed-topic',
        method: 'POST',
        path: '/topics',
        body: { name: topicName, assistantId }
      })
      if (assistant.status !== 201 || topic.status !== 201)
        throw new Error(`Seed failed: ${JSON.stringify({ assistant, topic })}`)
      return { assistantId, topicId: (topic.data as { id: string }).id }
    },
    { assistantName: ASSISTANT, topicName: TOPIC }
  )
  await page.evaluate(({ assistantId, topicId }) => {
    window.dispatchEvent(
      new CustomEvent('cherry:open-main-route', {
        cancelable: true,
        detail: { path: `/app/chat?assistantId=${assistantId}&topicId=${topicId}` }
      })
    )
  }, seeded)
  const assistantButton = page.getByRole('button', { name: ASSISTANT }).first()
  await expect(assistantButton).toBeVisible({ timeout: 30_000 })
  await assistantButton.click()
  const topicRow = page.getByTestId('topic-list-row').filter({ has: page.getByText(TOPIC, { exact: true }) })
  await expect(topicRow).toBeVisible({ timeout: 30_000 })
  await expect(topicRow.getByText(TOPIC, { exact: true })).toBeVisible()

  const logsDir = testInfo.outputPath('profile', 'logs')
  const logs = async () => {
    const names = (await readdir(logsDir)).filter((name) => /^app\..*\.log$/.test(name)).sort()
    const contents = await Promise.all(names.map((name) => readFile(join(logsDir, name), 'utf8')))
    return contents.flatMap((content) =>
      content
        .split('\n')
        .slice(0, -1)
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              id?: string
              message?: string
              params?: unknown
              status?: number
            }
        )
    )
  }
  const applicationReads = async () =>
    (await logs()).filter((line) => line.message === 'Incoming request: GET /archives' && line.id?.startsWith('req_'))
  // Starting before the first read is a conservative upper bound on time since its response.
  const initialReadStart = await page.evaluate(() => performance.now())
  await openArchive(page)
  await expect(page.getByText(labels.empty)).toBeVisible()
  await expect.poll(async () => (await applicationReads()).length).toBe(1)
  await testInfo.attach('archive-all-empty', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: labels.back }).first().click()
  await expect(topicRow).toBeVisible({ timeout: 30_000 })
  await topicRow.click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const archiveItem = menu.getByRole('menuitem', { name: labels.archive })
  await expect(archiveItem).toBeVisible()
  await archiveItem.click()
  await expect(topicRow).toHaveCount(0)
  const archived = await page.evaluate(async () => {
    const response = await window.api.dataApi.request({
      id: 'archive-diag-commit',
      method: 'GET',
      path: '/archives',
      params: { limit: 50 }
    })
    return response.data as {
      items: Array<{ name: string; domain: string; deletedAt: number; parentName: string | null }>
    }
  })
  expect(archived.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: TOPIC, domain: 'topics', deletedAt: expect.any(Number), parentName: ASSISTANT })
    ])
  )
  await openArchive(page)
  const elapsed = await page.evaluate((started) => performance.now() - started, initialReadStart)
  expect(
    elapsed,
    'precondition: returned after the dedupe window (conservative response age must be below 4000 ms)'
  ).toBeLessThan(4000)
  await expect(page.getByText(TOPIC, { exact: true })).toBeVisible()
  await expect(page.getByText(labels.empty)).toHaveCount(0)
  await expect.poll(async () => (await applicationReads()).length).toBe(2)
  const final = await applicationReads()
  expect(final[1].params).toEqual({ limit: 50 })
  const lines = await logs()
  const commit = lines.findIndex(
    (line) => line.id === 'archive-diag-commit' && line.message === 'Request completed: GET /archives'
  )
  const freshRead = lines.findIndex(
    (line) => line.id === final[1].id && line.message === 'Incoming request: GET /archives'
  )
  expect(commit).toBeGreaterThanOrEqual(0)
  expect(freshRead).toBeGreaterThan(commit)
  await testInfo.attach('archive-all-refreshed', { body: await page.screenshot(), contentType: 'image/png' })
  await testInfo.attach('archive-entry-reads', {
    body: JSON.stringify({ elapsed, reads: final }, null, 2),
    contentType: 'application/json'
  })
})
