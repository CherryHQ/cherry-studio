import { describe, expect, it } from 'vitest'

import { ExternalKnowledgeDocumentSchema, ExternalKnowledgeSourceSchema } from '../externalKnowledge'

const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const BASE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'
const DOCUMENT_ID = '0198f3f2-7d1a-7abc-8def-123456789ab3'
const ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const NOW = '2026-09-19T00:00:00.000Z'

const source = {
  id: SOURCE_ID,
  baseId: BASE_ID,
  connectionId: CONNECTION_ID,
  provider: 'feishu' as const,
  tenantId: 'tenant-key',
  spaceId: 'space-1',
  scope: { kind: 'node' as const, nodeId: 'node-1' },
  name: 'Engineering Wiki',
  state: 'active' as const,
  scheduleId: null,
  revision: 0,
  activeJobId: null,
  lastTrigger: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastOutcome: null,
  lastScannedCount: null,
  lastIndexedCount: null,
  lastUnchangedCount: null,
  lastSkippedCount: null,
  lastWarningCount: null,
  lastErrorSummary: null,
  lastSuccessfulSyncAt: null,
  createdAt: NOW,
  updatedAt: NOW
}

describe('ExternalKnowledgeSourceSchema', () => {
  it('accepts active and paused sources with provider-specific immutable scopes', () => {
    expect(ExternalKnowledgeSourceSchema.parse(source)).toEqual(source)
    expect(ExternalKnowledgeSourceSchema.safeParse({ ...source, state: 'paused' }).success).toBe(true)
    expect(
      ExternalKnowledgeSourceSchema.safeParse({
        ...source,
        scope: { kind: 'document', nodeId: 'node-1', remoteObjectId: 'doc-1' }
      }).success
    ).toBe(true)
    expect(ExternalKnowledgeSourceSchema.safeParse({ ...source, scope: { kind: 'space' } }).success).toBe(true)
  })

  it('rejects unconfirmed source states and provider scope fields', () => {
    expect(ExternalKnowledgeSourceSchema.safeParse({ ...source, state: 'manual' }).success).toBe(false)
    expect(ExternalKnowledgeSourceSchema.safeParse({ ...source, state: 'detached' }).success).toBe(false)
    expect(
      ExternalKnowledgeSourceSchema.safeParse({ ...source, apiDomain: 'https://open.larksuite.com' }).success
    ).toBe(false)
    expect(
      ExternalKnowledgeSourceSchema.safeParse({ ...source, provider: 'notion', scope: { kind: 'database' } }).success
    ).toBe(false)
  })

  it('validates latest-summary enums and nullable never-run values', () => {
    expect(
      ExternalKnowledgeSourceSchema.safeParse({
        ...source,
        lastTrigger: 'manual',
        lastStartedAt: NOW,
        lastFinishedAt: NOW,
        lastOutcome: 'completed-with-warnings',
        lastScannedCount: 10,
        lastIndexedCount: 2,
        lastUnchangedCount: 7,
        lastSkippedCount: 1,
        lastWarningCount: 1,
        lastErrorSummary: 'One document stayed stale',
        lastSuccessfulSyncAt: NOW
      }).success
    ).toBe(true)
    expect(ExternalKnowledgeSourceSchema.safeParse({ ...source, lastTrigger: 'hourly' }).success).toBe(false)
    expect(ExternalKnowledgeSourceSchema.safeParse({ ...source, lastOutcome: 'running' }).success).toBe(false)
  })
})

describe('ExternalKnowledgeDocumentSchema', () => {
  const document = {
    id: DOCUMENT_ID,
    sourceId: SOURCE_ID,
    remoteObjectId: 'doc-1',
    canonicalNodeId: 'node-1',
    parentNodeId: null,
    relativeBreadcrumb: ['Architecture'],
    title: 'Architecture',
    originalUrl: 'https://example.feishu.cn/wiki/node-1',
    remoteRevision: '42',
    contentHash: 'sha256:abc',
    lastSeenAt: NOW,
    availability: 'active' as const,
    knowledgeItemId: ITEM_ID,
    currentWarning: null,
    createdAt: NOW,
    updatedAt: NOW
  }

  it('requires an active document to own an item', () => {
    expect(ExternalKnowledgeDocumentSchema.parse(document)).toEqual(document)
    expect(ExternalKnowledgeDocumentSchema.safeParse({ ...document, knowledgeItemId: null }).success).toBe(false)
  })

  it('requires an unavailable tombstone to release its item', () => {
    expect(
      ExternalKnowledgeDocumentSchema.safeParse({
        ...document,
        availability: 'unavailable',
        knowledgeItemId: null,
        currentWarning: 'Unavailable from the selected scope'
      }).success
    ).toBe(true)
    expect(ExternalKnowledgeDocumentSchema.safeParse({ ...document, availability: 'unavailable' }).success).toBe(false)
  })

  it('rejects transient failures as persistent availability states and extra provider metadata', () => {
    expect(ExternalKnowledgeDocumentSchema.safeParse({ ...document, availability: 'failed' }).success).toBe(false)
    expect(ExternalKnowledgeDocumentSchema.safeParse({ ...document, accessToken: 'secret' }).success).toBe(false)
  })
})
