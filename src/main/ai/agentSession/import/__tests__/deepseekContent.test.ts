import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { FileManager } from '@main/services/file/FileManager'

import { deepseekContent } from '../deepseekContent'
import { message } from './fixtures'

setupTestDatabase()
let root: string
let manager: FileManager
beforeEach(async () => {
  BaseService.resetInstances()
  root = await mkdtemp(join(tmpdir(), 'deepseek-files-'))
  vi.mocked(application.getPath).mockImplementation((key, name) => join(root, key, name ?? ''))
  await mkdir(join(root, 'feature.files.data'), { recursive: true })
  manager = new FileManager()
  MockApplicationUtils.setService('FileManager', manager)
})
afterEach(async () => {
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it('exposes search and opened URLs as citations while retaining search context for continuation', async () => {
  const source = message(2, 1, 'ASSISTANT', 'An answer with sources')
  source.fragments.push(
    {
      type: 'TOOL_SEARCH',
      queries: ['example question'],
      results: [
        { url: 'https://example.com/search', title: 'Search result', snippet: 'Relevant evidence' },
        { url: 'javascript:alert(1)', title: 'Unsafe URL' },
        { url: null }
      ],
      status: 'FINISHED'
    },
    { type: 'TOOL_OPEN', url: 'https://example.com/search', title: 'Same page', status: 'FINISHED' },
    { type: 'TOOL_OPEN', url: 'https://example.com/open', title: 'Opened page', status: 'FINISHED' }
  )
  const result = await deepseekContent(
    source,
    async () => Buffer.alloc(0),
    {},
    () => {}
  )
  expect(result.parts.filter((part) => part.type === 'source-url')).toEqual([
    { type: 'source-url', sourceId: 'deepseek-2-1', url: 'https://example.com/search', title: 'Search result' },
    { type: 'source-url', sourceId: 'deepseek-2-2', url: 'https://example.com/open', title: 'Opened page' }
  ])
  expect(result.parts.filter((part) => part.type === 'text')).toEqual([
    { type: 'text', text: 'An answer with sources' }
  ])
  expect(JSON.stringify(result.model)).toContain('Relevant evidence')
  expect(JSON.stringify(result.model)).toContain('example question')
  expect(JSON.stringify(result.model)).toContain('https://example.com/open')
})

// Catch references to the source ZIP instead of persistent image bytes, and accidental executable search records.
it('stores an independent image and keeps reasoning, missing files, and searches inert', async () => {
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAusAAAAASUVORK5CYII=',
    'base64'
  )
  const source = message(1, null, 'USER', 'Image question')
  source.fragments.push({
    type: 'FILE',
    files: [
      { id: 'image', file_name: 'pixel.png', file_size: image.length, export_path: 'files/pixel.png', is_image: true },
      { id: 'missing', file_name: 'missing.pdf', file_size: 10, export_path: null, is_image: false }
    ]
  })
  const receipts: Record<string, string> = {}
  const result = await deepseekContent(
    source,
    async () => image,
    receipts,
    (id, entry) => {
      receipts[id] = entry
    }
  )
  expect(await readFile(manager.getPhysicalPath(receipts.image))).toEqual(image)
  expect(result.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'file',
        filename: 'pixel.png',
        mediaType: 'image/png',
        url: manager.getUrl(receipts.image)
      })
    ])
  )
  expect(JSON.stringify(result.model)).toContain(image.toString('base64'))
  expect(JSON.stringify(result.parts)).toContain('missing.pdf')
  const assistant = message(2, 1, 'ASSISTANT', 'Partial answer')
  assistant.status = 'TIMEOUT'
  assistant.fragments.push(
    { type: 'THINK', content: 'Historical thought', elapsed_secs: 1.5 },
    { type: 'TOOL_SEARCH', queries: ['example'], results: [{ url: 'https://example.com' }], status: 'FINISHED' }
  )
  const answer = await deepseekContent(
    assistant,
    async () => {
      throw new Error('Unexpected attachment read')
    },
    {},
    () => {}
  )
  expect(answer.parts).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'reasoning', text: 'Historical thought' })])
  )
  expect(JSON.stringify(answer.model)).toContain('https://example.com')
  if (answer.model.role !== 'assistant') throw new Error('Expected assistant history')
  expect(answer.model.content.every((part) => part.type === 'text')).toBe(true)
  expect(answer.model.usage.totalTokens).toBe(0)
})
