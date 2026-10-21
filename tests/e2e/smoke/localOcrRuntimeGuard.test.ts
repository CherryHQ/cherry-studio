import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron, type Page, type TestInfo } from '@playwright/test'
import * as z from 'zod'

import integrity from '../../../src/main/ai/localModel/catalog/onnxRuntimeIntegrity.json'
import { uiSelector } from '../../../src/renderer/utils/uiContract'
import {
  getKnowledgeItemDisplayTitle,
  KnowledgeBaseSchema,
  KnowledgeItemChunkSchema,
  KnowledgeItemSchema
} from '../../../src/shared/data/types/knowledge'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'

const baseName = 'Issue 22383 OCR runtime guard'
const dylibName = 'libonnxruntime.1.25.1.dylib'
const runtimeFiles = integrity.platforms['darwin-arm64'].files

function absoluteEnv(name: string, required = false): string | undefined {
  const value = process.env[name]
  if (value === undefined && !required) return undefined
  if (!value || !path.isAbsolute(value))
    throw new Error(`${name} must be an absolute path; received ${JSON.stringify(value)}`)
  return value
}

const test = base.extend<{ profile: string; phase: 'install' | 'reject' | 'recover' }>({
  phase: async ({}, use) => {
    const phase = process.env.ISSUE_22383_PHASE
    if (phase !== 'install' && phase !== 'reject' && phase !== 'recover') {
      throw new Error('ISSUE_22383_PHASE must be one of install, reject, recover')
    }
    absoluteEnv('ISSUE_22383_EVIDENCE_DIR')
    absoluteEnv('ISSUE_22383_STALE_ORT')
    await use(phase)
  },
  profile: async ({ phase: _phase }, use) => {
    const configured = absoluteEnv('ISSUE_22383_E2E_PROFILE')
    const profile = configured ?? (await mkdtemp(path.join(os.tmpdir(), 'cherry-e2e-22383-')))
    if (!(await stat(profile)).isDirectory()) throw new Error(`ISSUE_22383_E2E_PROFILE is not a directory: ${profile}`)
    const previous = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = profile
    try {
      await use(profile)
    } finally {
      if (previous === undefined) delete process.env.CS_DEV_PROFILE_ROOT
      else process.env.CS_DEV_PROFILE_ROOT = previous
      if (!configured) await rm(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ profile }, use) => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, CS_DEV_PROFILE_ROOT: profile, NODE_ENV: 'development' },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      try {
        if (app.process().exitCode === null) await app.close()
      } catch {
        // The install phase closes the app before staging the stale runtime.
      }
    }
  },
  mainWindow: async ({ electronApp }, use) => {
    let page: Page | undefined
    for (const candidate of electronApp.windows()) {
      if ((await candidate.title()) === 'Cherry Studio') page = candidate
    }
    page ??= await electronApp.waitForEvent('window', {
      predicate: async (candidate) => (await candidate.title()) === 'Cherry Studio',
      timeout: 60_000
    })
    await page.waitForSelector('#root', { state: 'attached', timeout: 60_000 })
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

test.describe.configure({ retries: 0 })

function ipcData<T>(response: unknown, schema: z.ZodType<T>): T {
  expect(response, JSON.stringify(response)).toMatchObject({ ok: true })
  return z.object({ ok: z.literal(true), data: schema }).parse(response).data
}

function runtimeDirectory(profile: string): string {
  return path.join(profile, 'userData/Toolchain/onnxruntime/napi-v6/darwin/arm64')
}

async function sha256(filename: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function assertHealthyRuntime(profile: string): Promise<void> {
  for (const [name, expected] of Object.entries(runtimeFiles)) {
    const filename = path.join(runtimeDirectory(profile), name)
    expect((await stat(filename)).size, filename).toBe(expected.sizeBytes)
    expect(await sha256(filename), filename).toBe(expected.sha256)
  }
}

async function pdfFixture(): Promise<string> {
  const filename = absoluteEnv('ISSUE_22383_PDF', true)!
  if (!(await stat(filename)).isFile()) throw new Error(`ISSUE_22383_PDF is not a file: ${filename}`)
  return filename
}

async function prepareShell(page: Page): Promise<void> {
  expect(process.platform, 'This scenario requires macOS arm64').toBe('darwin')
  expect(process.arch, 'This scenario requires macOS arm64').toBe('arm64')
  await page.evaluate(async (version) => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.privacy.policy_version', version)
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await expect(page.locator(uiSelector({ semanticId: 'app.sidebar' }))).toBeVisible({ timeout: 60_000 })
}

async function download(page: Page): Promise<void> {
  const result = await page.evaluate(() => window.api.ipcApi.request('local_model.download', { id: 'pp-ocrv6-medium' }))
  expect(ipcData(result, z.object({ result: z.string() })).result).toBe('ready')
  await assertReady(page)
}

async function assertReady(page: Page): Promise<void> {
  const result = await page.evaluate(() =>
    window.api.ipcApi.request('local_model.get_status', { id: 'pp-ocrv6-medium' })
  )
  expect(ipcData(result, z.object({ status: z.string() })).status).toBe('ready')
}

async function getData(page: Page, route: string): Promise<unknown> {
  const response = await page.evaluate(
    (route) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: route }),
    route
  )
  expect(response.status, JSON.stringify(response)).toBe(200)
  return response.data
}

async function existingBase(page: Page): Promise<string> {
  const response = z
    .object({ items: z.object({ id: z.string(), name: z.string() }).array() })
    .parse(await getData(page, '/knowledge-bases'))
  const bases = response.items.filter((entry) => entry.name === baseName)
  expect(bases, 'Run install first on the same ISSUE_22383_E2E_PROFILE').toHaveLength(1)
  return bases[0].id
}

async function addPdf(page: Page, baseId: string, pdf: string, status: 'completed' | 'failed') {
  const list = async () =>
    z.object({ items: KnowledgeItemSchema.array() }).parse(await getData(page, `/knowledge-bases/${baseId}/items`))
      .items
  const before = new Set((await list()).map((item) => item.id))
  const added = await page.evaluate(
    ({ baseId, pdf, source }) =>
      window.api.ipcApi.request('knowledge.add_items', {
        baseId,
        items: [{ type: 'file', data: { source, path: pdf } }],
        conflictStrategy: 'rename'
      }),
    { baseId, pdf, source: path.basename(pdf) }
  )
  expect(ipcData(added, z.object({ status: z.string() })).status).toBe('added')
  const newItems = (await list()).filter((item) => !before.has(item.id))
  expect(newItems).toHaveLength(1)
  const itemId = newItems[0].id
  let item = newItems[0]
  await expect
    .poll(
      async () => {
        item = KnowledgeItemSchema.parse(await getData(page, `/knowledge-items/${itemId}`))
        return item.status === 'completed' || item.status === 'failed'
      },
      { timeout: 600_000, intervals: [1000, 2000, 5000], message: `Wait for real PDF indexing: ${itemId}` }
    )
    .toBe(true)
  expect(item.status, JSON.stringify(item)).toBe(status)
  if (status === 'completed') {
    const chunks = await page.evaluate(
      ({ baseId, itemId }) => window.api.ipcApi.request('knowledge.list_item_chunks', { baseId, itemId }),
      { baseId, itemId }
    )
    expect(
      ipcData(chunks, KnowledgeItemChunkSchema.array())
        .map((chunk) => chunk.content)
        .join('\n')
    ).toContain('CHERRY OCR PROBE')
  }
  return item
}

async function screenshot(
  page: Page,
  baseId: string,
  item: z.infer<typeof KnowledgeItemSchema>,
  filename: string,
  info: TestInfo
): Promise<void> {
  const navigation = await page.evaluate(
    (baseId) =>
      window.api.ipcApi.request('navigation.open_route_in_main', {
        path: `/app/knowledge?baseId=${encodeURIComponent(baseId)}`
      }),
    baseId
  )
  z.object({ ok: z.literal(true) }).parse(navigation)
  await page.reload()
  await expect(page.locator(uiSelector({ semanticId: 'knowledge.view' })).filter({ visible: true })).toBeVisible()
  const row = page.getByRole('row', { name: `Open ${getKnowledgeItemDisplayTitle(item)}`, exact: true })
  await expect(row).toHaveCount(1)
  await expect(row).toBeVisible({ timeout: 60_000 })
  await expect(row).toContainText(item.status === 'completed' ? 'Ready' : 'Error')
  const target = info.outputPath(filename)
  await page.screenshot({ path: target, fullPage: true })
  await info.attach(filename, { path: target, contentType: 'image/png' })
  const evidence = absoluteEnv('ISSUE_22383_EVIDENCE_DIR')
  if (evidence) {
    try {
      await mkdir(evidence, { recursive: true })
      await copyFile(target, path.join(evidence, filename))
    } catch (error) {
      await info.attach('optional evidence copy failed', { body: String(error), contentType: 'text/plain' })
    }
  }
}

async function assertNoNativeAbort(profile: string, info: TestInfo): Promise<void> {
  const directory = path.join(profile, 'logs')
  const logs = (await readdir(directory)).filter((name) => name.endsWith('.log'))
  expect(logs, `Expected app logs in ${directory}`).not.toHaveLength(0)
  const text = (await Promise.all(logs.map((name) => readFile(path.join(directory, name), 'utf8')))).join('\n')
  await info.attach('app logs', { body: text, contentType: 'text/plain' })
  expect(text).not.toContain('The requested API version [')
}

test('install: real OCR succeeds before staging the stale runtime', async ({
  phase,
  profile,
  mainWindow: page,
  electronApp
}, info) => {
  test.setTimeout(900_000)
  test.skip(phase !== 'install', 'Select with ISSUE_22383_PHASE=install')
  const pdf = await pdfFixture()
  const stale = path.join(absoluteEnv('ISSUE_22383_STALE_ORT', true)!, dylibName)
  expect((await stat(stale)).isFile(), stale).toBe(true)
  const staleHash = await sha256(stale)
  expect(staleHash, 'The supplied stale runtime must differ from the healthy runtime').not.toBe(
    runtimeFiles[dylibName].sha256
  )
  await prepareShell(page)
  await download(page)
  await assertHealthyRuntime(profile)
  const created = await page.evaluate(
    (name) =>
      window.api.ipcApi.request('knowledge.create_base', {
        base: { name, embeddingModelId: null, dimensions: null, fileProcessorId: 'local-document' }
      }),
    baseName
  )
  const baseId = ipcData(created, KnowledgeBaseSchema).id
  const item = await addPdf(page, baseId, pdf, 'completed')
  await screenshot(page, baseId, item, 'install-ok.png', info)
  await electronApp.close()
  const installed = path.join(runtimeDirectory(profile), dylibName)
  await copyFile(stale, installed)
  expect(await sha256(installed)).toBe(staleHash)
})

test('reject: stale runtime fails with actionable recovery instead of a native abort', async ({
  phase,
  profile,
  mainWindow: page
}, info) => {
  test.setTimeout(900_000)
  test.skip(phase !== 'reject', 'Select with ISSUE_22383_PHASE=reject')
  test.skip(process.env.ISSUE_22383_E2E_PROFILE === undefined, 'reject needs the profile populated by install')
  const pdf = await pdfFixture()
  await prepareShell(page)
  await assertReady(page)
  expect(await sha256(path.join(runtimeDirectory(profile), dylibName))).not.toBe(runtimeFiles[dylibName].sha256)
  const baseId = await existingBase(page)
  const item = await addPdf(page, baseId, pdf, 'failed')
  expect(item.error).toEqual(expect.any(String))
  for (const expected of [
    '1.25.1',
    runtimeDirectory(profile),
    'Fully quit Cherry Studio',
    'remove only that runtime folder',
    'Download',
    'retry or reindex'
  ]) {
    expect(item.error).toContain(expected)
  }
  expect(item.error).not.toContain('produced no indexable text')
  await info.attach('item error', { body: item.error!, contentType: 'text/plain' })
  await assertNoNativeAbort(profile, info)
  await screenshot(page, baseId, item, 'reject.png', info)
})

test('recover: replacing only the runtime restores real OCR and preserves model weights', async ({
  phase,
  profile,
  mainWindow: page
}, info) => {
  test.setTimeout(900_000)
  test.skip(phase !== 'recover', 'Select with ISSUE_22383_PHASE=recover')
  test.skip(process.env.ISSUE_22383_E2E_PROFILE === undefined, 'recover needs the profile populated by install')
  const pdf = await pdfFixture()
  await prepareShell(page)
  await assertReady(page)
  expect(await sha256(path.join(runtimeDirectory(profile), dylibName))).not.toBe(runtimeFiles[dylibName].sha256)
  const baseId = await existingBase(page)
  const modelDirectory = path.join(profile, 'userData/Runtime/models/pp-ocrv6')
  const modelMtimes = async () =>
    Object.fromEntries(
      await Promise.all(
        ['PP-OCRv6_medium_det.onnx', 'PP-OCRv6_medium_rec.onnx', 'ppocrv6_dict.txt'].map(async (name) => [
          name,
          String((await stat(path.join(modelDirectory, name), { bigint: true })).mtimeNs)
        ])
      )
    )
  const before = await modelMtimes()
  await rm(runtimeDirectory(profile), { recursive: true })
  await download(page)
  await assertHealthyRuntime(profile)
  const after = await modelMtimes()
  await info.attach('model mtimes', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json'
  })
  expect(after, 'Repair must reuse the downloaded OCR model files').toEqual(before)
  const item = await addPdf(page, baseId, pdf, 'completed')
  await screenshot(page, baseId, item, 'recover.png', info)
  await assertNoNativeAbort(profile, info)
})
