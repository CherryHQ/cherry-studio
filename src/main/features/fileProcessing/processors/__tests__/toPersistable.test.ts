/**
 * Whitelist invariant (A1) tests for the real `toPersistable` implementations
 * of every remote-poll capability handler. These tests intentionally bypass
 * the higher-level orchestrator mocks and exercise each handler's actual
 * projection logic to guarantee that no sensitive material (apiKey, raw
 * remote-context fields) ever reaches `jobTable.metadata`.
 */
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import { type FileInfo, FileInfoSchema } from '@shared/file/types'
import { describe, expect, it } from 'vitest'

import { doc2xDocumentToMarkdownHandler } from '../doc2x/document-to-markdown/handler'
import { mineruDocumentToMarkdownHandler } from '../mineru/document-to-markdown/handler'
import { paddleDocumentToMarkdownHandler } from '../paddleocr/document-to-markdown/handler'
import type { PreparedRemoteJob } from '../types'

const createFileInfo = (input: Parameters<typeof FileInfoSchema.parse>[0]): FileInfo =>
  FileInfoSchema.parse(input) as FileInfo

const FAKE_PDF = createFileInfo({
  path: '/tmp/paper.pdf',
  name: 'paper',
  size: 99_000,
  ext: 'pdf',
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1,
  modifiedAt: 1
})
const FAKE_DATA_ID = '019606a0-0000-7000-8000-000000000001'

function buildConfig(id: 'doc2x' | 'mineru' | 'paddleocr', apiHost: string): FileProcessorMerged {
  return {
    id,
    type: 'api',
    apiKeys: ['SUPER_SECRET'],
    capabilities: [
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost
      }
    ]
  } as FileProcessorMerged
}

async function prepareRemote(
  handler:
    | typeof doc2xDocumentToMarkdownHandler
    | typeof mineruDocumentToMarkdownHandler
    | typeof paddleDocumentToMarkdownHandler,
  config: FileProcessorMerged
): Promise<PreparedRemoteJob<'document_to_markdown'>> {
  const prepared = await handler.prepare(FAKE_PDF, config, undefined, { dataId: FAKE_DATA_ID })
  if (prepared.mode !== 'remote-poll') {
    throw new Error('Expected remote-poll prepared job')
  }
  return prepared as PreparedRemoteJob<'document_to_markdown'>
}

describe('A1 whitelist invariant: real toPersistable() never emits apiKey', () => {
  it('doc2x.toPersistable excludes apiKey and includes publishable fields', async () => {
    const config = buildConfig('doc2x', 'https://doc2x.example.com')
    const prepared = await prepareRemote(doc2xDocumentToMarkdownHandler, config)

    const persisted = prepared.toPersistable(
      { apiHost: 'https://doc2x.example.com', apiKey: 'SUPER_SECRET', stage: 'exporting' } as never,
      'provider-task-xyz'
    )

    const serialized = JSON.stringify(persisted)
    expect(serialized).not.toContain('SUPER_SECRET')
    expect(serialized).not.toContain('apiKey')
    expect(persisted).toMatchObject({
      providerTaskId: 'provider-task-xyz',
      apiHost: 'https://doc2x.example.com',
      stage: 'exporting'
    })
  })

  it('mineru.toPersistable excludes apiKey and includes publishable fields', async () => {
    const config = buildConfig('mineru', 'https://mineru.example.com')
    const prepared = await prepareRemote(mineruDocumentToMarkdownHandler, config)

    const persisted = prepared.toPersistable(
      { apiHost: 'https://mineru.example.com', apiKey: 'SUPER_SECRET' } as never,
      'batch-id-abc'
    )

    const serialized = JSON.stringify(persisted)
    expect(serialized).not.toContain('SUPER_SECRET')
    expect(serialized).not.toContain('apiKey')
    expect(persisted).toMatchObject({
      providerTaskId: 'batch-id-abc',
      apiHost: 'https://mineru.example.com'
    })
  })

  it('paddleocr.toPersistable excludes apiKey and includes publishable fields', async () => {
    const config = buildConfig('paddleocr', 'https://paddle.example.com')
    const prepared = await prepareRemote(paddleDocumentToMarkdownHandler, config)

    const persisted = prepared.toPersistable(
      { apiHost: 'https://paddle.example.com', apiKey: 'SUPER_SECRET' } as never,
      'job-id-123'
    )

    const serialized = JSON.stringify(persisted)
    expect(serialized).not.toContain('SUPER_SECRET')
    expect(serialized).not.toContain('apiKey')
    expect(persisted).toMatchObject({
      providerTaskId: 'job-id-123',
      apiHost: 'https://paddle.example.com'
    })
  })
})
