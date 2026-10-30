import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { PDFDocument } from 'pdf-lib'

import type { JobSnapshot } from '../../../src/shared/data/api/schemas/jobs'
import type { KnowledgeItemListResponse } from '../../../src/shared/data/api/schemas/knowledges'
import type { KnowledgeBase, KnowledgeAddItemsResult } from '../../../src/shared/data/types/knowledge'
import type { IpcResult } from '../../../src/shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '../../../src/shared/types/file'
import { expect, test } from './fixtures/electron.fixture'

test('MinerU queue stage and sampled total wait become parsing progress', async ({ mainWindow }, testInfo) => {
  test.setTimeout(120_000)
  const name = `issue-22761-${randomUUID()}`
  const fileName = `${name}.pdf`
  const batchId = randomUUID()
  let phase: 'pending' | 'running' = 'pending'
  let origin = ''
  let baseId: string | undefined
  let itemId: string | undefined
  let jobIds: string[] = []
  const observations: { timestamp: string; text: string }[] = []
  const requests: { method?: string; path?: string; stage?: string; timestamp: string }[] = []
  const httpServer = createServer((req, res) => {
    const entry: (typeof requests)[number] = { method: req.method, path: req.url, timestamp: new Date().toISOString() }
    requests.push(entry)
    req.resume()
    req.on('end', () => {
      let data: unknown
      if (req.method === 'POST' && req.url === '/api/v4/file-urls/batch') {
        data = { batch_id: batchId, file_urls: [`${origin}/upload`] }
      } else if (req.method === 'PUT' && req.url === '/upload') {
        res.writeHead(200).end()
        return
      } else if (req.method === 'GET' && req.url === `/api/v4/extract-results/batch/${batchId}`) {
        entry.stage = phase
        data = {
          batch_id: batchId,
          extract_result: [
            {
              file_name: fileName,
              state: phase,
              ...(phase === 'running'
                ? { extract_progress: { extracted_pages: 1, total_pages: 4, start_time: new Date().toISOString() } }
                : {})
            }
          ]
        }
      } else {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 0, data }))
    })
  })
  let preferences: Awaited<ReturnType<typeof prepare>> | undefined
  const ipc = <T>(route: string, input: unknown) =>
    mainWindow
      .evaluate(async ({ route, input }) => (await window.api.ipcApi.request(route, input)) as IpcResult<unknown>, {
        route,
        input
      })
      .then((result) => {
        if (!result.ok) throw new Error(`${route} failed: ${result.error.code}: ${result.error.message}`)
        return result.data as T
      })
  async function prepare() {
    return mainWindow.evaluate(async () => {
      const previous = {
        'app.language': await window.api.preference.get('app.language'),
        'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status'),
        'app.privacy.data_collection.enabled': await window.api.preference.get('app.privacy.data_collection.enabled'),
        'feature.file_processing.overrides': await window.api.preference.get('feature.file_processing.overrides')
      }
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false
      })
      return previous
    })
  }
  const readIds = async () => {
    if (!baseId) return
    const ids = await mainWindow.evaluate(async (id) => {
      const items = await window.api.dataApi.request({
        id: 'mineru-items',
        method: 'GET',
        path: `/knowledge-bases/${id}/items`
      })
      if (items.error) throw new Error(items.error.message)
      const item = (items.data as KnowledgeItemListResponse).items[0]
      const jobs = await window.api.dataApi.request({
        id: 'mineru-jobs',
        method: 'GET',
        path: '/jobs',
        params: { type: 'file-processing.remote-poll', limit: 500 }
      })
      if (jobs.error) throw new Error(jobs.error.message)
      return {
        itemId: item?.id,
        jobIds: (jobs.data as JobSnapshot[])
          .filter((job) => (job.input as { context?: { dataId?: string } }).context?.dataId === item?.id)
          .map((job) => job.id)
      }
    }, baseId)
    itemId = ids.itemId
    jobIds = ids.jobIds
  }
  try {
    preferences = await prepare()
    await mainWindow.reload()
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    const address = httpServer.address()
    if (!address || typeof address === 'string') throw new Error('MinerU fixture did not bind a TCP port')
    origin = `http://127.0.0.1:${address.port}`
    await mainWindow.evaluate(async (apiHost) => {
      const overrides = await window.api.preference.get('feature.file_processing.overrides')
      await window.api.preference.set('feature.file_processing.overrides', {
        ...overrides,
        mineru: {
          ...overrides.mineru,
          apiKeys: ['e2e-token'],
          capabilities: {
            ...overrides.mineru?.capabilities,
            document_to_markdown: { ...overrides.mineru?.capabilities?.document_to_markdown, apiHost }
          }
        }
      })
    }, origin)
    const document = await PDFDocument.create()
    document.addPage().drawText('MinerU queue status fixture')
    const pdfPath = testInfo.outputPath(fileName) as AbsoluteFilePath
    await writeFile(pdfPath, await document.save())
    const base = await ipc<KnowledgeBase>('knowledge.create_base', {
      base: { name, fileProcessorId: 'mineru' }
    })
    baseId = base.id
    const added = await ipc<KnowledgeAddItemsResult>('knowledge.add_items', {
      baseId,
      items: [{ type: 'file', data: { source: pdfPath, path: pdfPath } }]
    })
    expect(added.status).toBe('added')
    const sidebarButton = mainWindow.getByRole('button', { name: 'Knowledge Base', exact: true }).first()
    await sidebarButton.click({ noWaitAfter: true })
    await expect(mainWindow.locator('[data-ui="knowledge.view"]').first()).toBeVisible({ timeout: 30_000 })
    const navigation = mainWindow.locator('[data-ui="knowledge.navigation"]')
    await navigation.getByText(name, { exact: true }).first().click()
    await expect(mainWindow.getByRole('grid', { name: 'Data sources', exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    const row = mainWindow.getByRole('row').filter({ hasText: fileName }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        async () => {
          const text = await row.innerText()
          observations.push({ timestamp: new Date().toISOString(), text })
          return text
        },
        { timeout: 30_000 }
      )
      .toContain('Queued')
    await expect(row).not.toContainText('0%')
    const badge = row.getByLabel(/Queued at the document service/)
    await expect(badge).toBeVisible()
    await badge.hover()
    await expect(badge).toHaveAttribute('aria-label', /Total wait:\s*\S/, {
      timeout: 10_000
    })
    await readIds()
    expect(itemId).toBeTruthy()
    expect(jobIds).toHaveLength(1)
    const queuedPath = testInfo.outputPath('mineru-queued.png')
    await mainWindow.bringToFront()
    await mainWindow.waitForTimeout(300)
    await badge.hover()
    await mainWindow.screenshot({ path: queuedPath })
    await testInfo.attach('mineru-queued.png', { path: queuedPath, contentType: 'image/png' })
    phase = 'running'
    await expect
      .poll(
        async () => {
          const text = await row.innerText()
          observations.push({ timestamp: new Date().toISOString(), text })
          return text
        },
        { timeout: 30_000 }
      )
      .toContain('Parsing 25%')
    const parsingPath = testInfo.outputPath('mineru-parsing-25.png')
    await mainWindow.bringToFront()
    await mainWindow.waitForTimeout(300)
    await mainWindow.screenshot({ path: parsingPath })
    await testInfo.attach('mineru-parsing-25.png', { path: parsingPath, contentType: 'image/png' })
  } finally {
    try {
      try {
        await readIds()
      } finally {
        const journalPath = testInfo.outputPath('mineru-journal.json')
        await writeFile(
          journalPath,
          JSON.stringify({ requests, batchId, baseId, itemId, jobIds, observations }, null, 2)
        )
        await testInfo.attach('mineru-journal.json', { path: journalPath, contentType: 'application/json' })
      }
    } finally {
      try {
        if (baseId) await ipc<void>('knowledge.delete_base', { baseId })
      } finally {
        try {
          if (preferences)
            await mainWindow.evaluate((previous) => window.api.preference.setMultiple(previous), preferences)
        } finally {
          httpServer.closeAllConnections()
          if (httpServer.listening)
            await new Promise<void>((resolve, reject) =>
              httpServer.close((error) => (error ? reject(error) : resolve()))
            )
        }
      }
    }
  }
})
