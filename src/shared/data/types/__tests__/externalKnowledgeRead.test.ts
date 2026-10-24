import { describe, expect, it } from 'vitest'

import {
  ExternalKnowledgeReadDescriptorSchema,
  ExternalKnowledgeDocumentReadSchema,
  ExternalKnowledgeScopePreviewSchema,
  ExternalKnowledgeScopeResolutionSchema
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
  it('represents metadata-only counts without claiming an exact embedding cost', () => {
    const preview = {
      resolution,
      visibleNodeCount: 4,
      supportedDocxCount: 2,
      unsupportedOrSkippedCount: 1,
      embeddingCostExact: false as const,
      warnings: []
    }

    expect(ExternalKnowledgeScopePreviewSchema.parse(preview)).toEqual(preview)
    expect(ExternalKnowledgeScopePreviewSchema.safeParse({ ...preview, embeddingCostExact: true }).success).toBe(false)
  })

  it('allows a zero-Docx scope with a machine-readable warning', () => {
    expect(
      ExternalKnowledgeScopePreviewSchema.safeParse({
        resolution,
        visibleNodeCount: 3,
        supportedDocxCount: 0,
        unsupportedOrSkippedCount: 3,
        embeddingCostExact: false,
        warnings: ['no-supported-documents']
      }).success
    ).toBe(true)
  })
})
