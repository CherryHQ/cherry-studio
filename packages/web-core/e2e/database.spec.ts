import type { BranchMessagesResponse, Message } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'

import { expect, reloadHarness, test } from './fixtures'

const textOf = (message: Message) =>
  (message.data.parts ?? []).map((part) => ('text' in part ? part.text : '')).join('')

test('migrates an OPFS database with the full schema and keeps it across a reload (AC3)', async ({ page, account }) => {
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)

  const opened = await page.evaluate((account) => harness.client.open(account), account)
  expect(opened.path).toContain(encodeURIComponent(account))

  const objects = await page.evaluate(() =>
    harness.client.send<{ name: string }[]>('sql', {
      sql: `SELECT name FROM sqlite_master WHERE name IN ('message_fts', 'message_ai', 'message_ad', 'message_au', '__drizzle_migrations') ORDER BY name`
    })
  )
  expect(objects.map((row) => row.name)).toEqual([
    '__drizzle_migrations',
    'message_ad',
    'message_ai',
    'message_au',
    'message_fts'
  ])
  const [{ applied }] = await page.evaluate(() =>
    harness.client.send<{ applied: number }[]>('sql', { sql: 'SELECT count(*) AS applied FROM __drizzle_migrations' })
  )
  expect(applied).toBeGreaterThanOrEqual(28)

  await page.evaluate(() => harness.client.send('seedMessages', { count: 500 }))
  await reloadHarness(page)
  await page.evaluate((account) => harness.client.open(account), account)

  const [{ messages }] = await page.evaluate(() =>
    harness.client.send<{ messages: number }[]>('sql', {
      sql: "SELECT count(*) AS messages FROM message WHERE role != 'root'"
    })
  )
  expect(messages).toBe(500)
  expect(await page.evaluate(() => harness.client.send('integrity'))).toEqual({
    integrity: 'ok',
    foreignKeyViolations: 0
  })
})

test('serves TopicService and MessageService through the DataApi server (AC6)', async ({ page, account }) => {
  await page.evaluate((account) => harness.client.open(account), account)

  const created = await page.evaluate(() =>
    harness.client.request<Topic>('POST', '/topics', { body: { name: 'Web topic' } })
  )
  expect(created.status).toBe(201)
  const topic = created.data!

  const contents = ['hello from the browser', 'the worker answers with a pelican', 'and a follow-up question']
  for (const [index, text] of contents.entries()) {
    const response = await page.evaluate(
      ({ topicId, text, role }) =>
        harness.client.request<Message>('POST', `/topics/${topicId}/messages`, {
          params: { topicId },
          body: { role, data: { parts: [{ type: 'text', text }] }, status: 'success' }
        }),
      { topicId: topic.id, text, role: index % 2 === 0 ? 'user' : 'assistant' }
    )
    expect(response.status).toBe(201)
  }

  const branch = await page.evaluate(
    (topicId) =>
      harness.client.request<BranchMessagesResponse>('GET', `/topics/${topicId}/messages`, { params: { limit: 50 } }),
    topic.id
  )
  expect(branch.status).toBe(200)
  expect(branch.data!.items.map((item) => textOf(item.message))).toEqual(contents)

  const listed = await page.evaluate(() => harness.client.request<{ items: Topic[] }>('GET', '/topics'))
  expect(listed.data!.items.map((item) => item.name)).toContain('Web topic')

  const hits = await page.evaluate(
    (topicId) =>
      harness.client.send<{ items: { messageId: string; snippet: string }[] }>('searchMessages', {
        q: 'pelican',
        topicId
      }),
    topic.id
  )
  expect(hits.items).toHaveLength(1)
  expect(hits.items[0].snippet).toContain('pelican')

  const unknown = await page.evaluate(() => harness.client.request('GET', '/topics/does-not-exist'))
  expect(unknown.status).toBe(404)

  const channels = await page.evaluate(() => harness.broadcasts.map((broadcast) => broadcast.channel))
  expect(channels).toContain('data-api:data-changed')
})

test('fails pending calls instead of hanging when the Worker cannot load', async ({ page }) => {
  const outcome = await page.evaluate(() => {
    const client = new harness.CoreClient(new Worker('/missing-core-worker.js', { type: 'module' }))
    return client.open('unreachable').then(
      () => 'opened',
      (error: Error) => error.name
    )
  })
  expect(outcome).toBe('CoreWorkerCrashed')
})
