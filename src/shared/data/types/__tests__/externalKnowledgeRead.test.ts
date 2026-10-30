import { describe, expect, it } from 'vitest'

import {
  ExternalKnowledgeReadDescriptorSchema,
  ExternalKnowledgeDocumentReadSchema,
  ExternalKnowledgeScopePreviewSchema,
  ExternalKnowledgeScopeResolutionSchema,
  FeishuWikiSpacePreviewSchema
} from '../externalKnowledgeRead'

const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'

const descriptor = {
  remoteObjectId: 'doc-1',
  nodeId: 'node-1',
  parentNodeId: null,
  relativeBreadcrumb: ['Engineering', 'Architecture'],
  title: 'Architecture',
  originalUrl: 'https://example.feishu.cn/wiki/node-1',
  remoteRevision: '42',
  documentKind: 'document' as const,
  supportState: 'supported' as const
}

const resolution = {
  provider: 'feishu' as const,
  connectionId: CONNECTION_ID,
  account: { userId: 'user-1', displayName: 'Ada' },
  tenantId: 'tenant-1',
  spaceId: 'space-1',
  scope: { kind: 'node' as const, nodeId: 'node-1' },
  selected: descriptor
}

describe('ExternalKnowledgeReadDescriptorSchema', () => {
  it('preserves the provider-neutral identity needed for later canonical reconciliation', () => {
    expect(ExternalKnowledgeReadDescriptorSchema.parse(descriptor)).toEqual(descriptor)
  })

  it('rejects credentials and provider-private traversal payloads', () => {
    expect(ExternalKnowledgeReadDescriptorSchema.safeParse({ ...descriptor, accessToken: 'secret' }).success).toBe(
      false
    )
    expect(
      ExternalKnowledgeReadDescriptorSchema.safeParse({ ...descriptor, objToken: 'provider-private' }).success
    ).toBe(false)
  })
})

describe('ExternalKnowledgeDocumentReadSchema', () => {
  it('carries normalized Markdown beside the provider-neutral descriptor only', () => {
    const read = { descriptor, contentType: 'markdown' as const, content: '---\ntitle: Kept\n---\n{{placeholder}}' }

    expect(ExternalKnowledgeDocumentReadSchema.parse(read)).toEqual(read)
    expect(ExternalKnowledgeDocumentReadSchema.safeParse({ ...read, providerPayload: { private: true } }).success).toBe(
      false
    )
  })
})

describe('ExternalKnowledgeScopeResolutionSchema', () => {
  it('returns the validated account, tenant, space, selection, and breadcrumb without credentials', () => {
    expect(ExternalKnowledgeScopeResolutionSchema.parse(resolution)).toEqual(resolution)
  })

  it('rejects unsupported providers and private connection data', () => {
    expect(ExternalKnowledgeScopeResolutionSchema.safeParse({ ...resolution, provider: 'lark' }).success).toBe(false)
    expect(
      ExternalKnowledgeScopeResolutionSchema.safeParse({ ...resolution, credentialReference: 'feishu:private' }).success
    ).toBe(false)
  })
})

describe('ExternalKnowledgeScopePreviewSchema', () => {
  it('accepts public document details but rejects private payloads and unknown skip reasons', () => {
    const preview = {
      resolution,
      visibleNodeCount: 2,
      supportedDocxCount: 1,
      unsupportedOrSkippedCount: 1,
      supportedDocuments: [{ nodeId: 'node-1', title: 'Architecture', documentKind: 'document' }],
      skippedItems: [{ nodeId: 'sheet-1', title: 'Roadmap', documentKind: 'spreadsheet', reason: 'unsupported-type' }],
      embeddingCostExact: false as const,
      warnings: []
    }

    expect(ExternalKnowledgeScopePreviewSchema.safeParse(preview).success).toBe(true)
    expect(ExternalKnowledgeScopePreviewSchema.safeParse({ ...preview, embeddingCostExact: true }).success).toBe(false)
    expect(
      ExternalKnowledgeScopePreviewSchema.safeParse({
        ...preview,
        supportedDocuments: [{ ...preview.supportedDocuments[0], providerData: { objToken: 'private' } }]
      }).success
    ).toBe(false)
    expect(
      ExternalKnowledgeScopePreviewSchema.safeParse({
        ...preview,
        skippedItems: [{ ...preview.skippedItems[0], reason: 'unknown' }]
      }).success
    ).toBe(false)
  })

  it('allows a zero-Docx scope with a machine-readable warning', () => {
    expect(
      ExternalKnowledgeScopePreviewSchema.safeParse({
        resolution,
        visibleNodeCount: 3,
        supportedDocxCount: 0,
        unsupportedOrSkippedCount: 3,
        supportedDocuments: [],
        skippedItems: [
          { nodeId: 'sheet-1', title: 'Roadmap', documentKind: 'spreadsheet', reason: 'unsupported-type' },
          { nodeId: 'file-1', title: 'Archive', documentKind: 'file', reason: 'unsupported-type' },
          { nodeId: 'shortcut-1', title: 'Other Wiki', documentKind: 'document', reason: 'cross-space-shortcut' }
        ],
        embeddingCostExact: false,
        warnings: ['no-supported-documents']
      }).success
    ).toBe(true)
  })
})

describe('FeishuWikiSpacePreviewSchema', () => {
  it('requires document details for a whole-space preview', () => {
    const preview = {
      space: { spaceId: 'space-1', name: 'Engineering', description: null },
      visibleNodeCount: 0,
      supportedDocxCount: 0,
      unsupportedOrSkippedCount: 0,
      embeddingCostExact: false,
      warnings: ['no-supported-documents']
    }

    expect(FeishuWikiSpacePreviewSchema.safeParse(preview).success).toBe(false)
    expect(
      FeishuWikiSpacePreviewSchema.safeParse({ ...preview, supportedDocuments: [], skippedItems: [] }).success
    ).toBe(true)
  })
})
