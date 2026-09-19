import { describe, expect, it, vi } from 'vitest'

import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

import {
  FeishuKnowledgeReadError,
  parseFeishuKnowledgeUrl,
  resolveFeishuKnowledgeScope,
  type FeishuKnowledgeReadOperations,
  type FeishuWikiNode
} from '../feishuKnowledgeReadAdapter'

const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'

function connection(): ExternalKnowledgeConnection {
  return {
    id: CONNECTION_ID,
    provider: 'feishu',
    appCredentialSource: 'custom',
    appId: 'cli_test',
    applicationName: null,
    accountUserId: 'user-1',
    accountOpenId: 'open-1',
    accountUnionId: null,
    tenantKey: 'tenant-1',
    displayName: 'Ada',
    avatarUrl: null,
    grantedScopes: [],
    authorizationStatus: 'connected',
    credentialReference: 'feishu:private',
    lastValidatedAt: '2026-09-19T00:00:00.000Z',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z'
  }
}

function node(overrides: Partial<FeishuWikiNode> = {}): FeishuWikiNode {
  return {
    spaceId: 'space-1',
    nodeToken: 'wiki-node',
    objToken: 'doc-1',
    objType: 'docx',
    parentNodeToken: 'wiki-parent',
    nodeType: 'origin',
    originNodeToken: null,
    originSpaceId: null,
    title: 'Architecture',
    hasChild: false,
    objEditTime: '42',
    ...overrides
  }
}

function operations(value: FeishuWikiNode = node()): FeishuKnowledgeReadOperations {
  return { getNode: vi.fn().mockResolvedValue(value) }
}

describe('parseFeishuKnowledgeUrl', () => {
  it.each([
    ['https://acme.feishu.cn/wiki/wikcnRoot', { kind: 'wiki', token: 'wikcnRoot' }],
    ['https://acme.feishu.cn/wiki/wikcnNode?from=space', { kind: 'wiki', token: 'wikcnNode' }],
    ['https://acme.feishu.cn/docx/doxcnDocument#heading', { kind: 'docx', token: 'doxcnDocument' }]
  ] as const)('recognizes supported China Feishu URLs and extracts only the trusted token', (url, expected) => {
    expect(parseFeishuKnowledgeUrl(url)).toMatchObject(expected)
  })

  it.each([
    'http://acme.feishu.cn/wiki/wikcnNode',
    'https://acme.larksuite.com/wiki/wikcnNode',
    'https://feishu.cn.attacker.invalid/wiki/wikcnNode',
    'https://user:password@acme.feishu.cn/wiki/wikcnNode',
    'https://acme.feishu.cn:444/wiki/wikcnNode',
    'https://acme.feishu.cn/sheets/shtcnSheet',
    'https://acme.feishu.cn/wiki/../docx/doxcnDocument',
    'not-a-url'
  ])('rejects untrusted or unsupported URL %s', (url) => {
    expect(() => parseFeishuKnowledgeUrl(url)).toThrowError(FeishuKnowledgeReadError)
  })
})

describe('resolveFeishuKnowledgeScope', () => {
  it('resolves a Wiki root into a space scope and a safe selected descriptor', async () => {
    const result = await resolveFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/wikcnRoot?secret=query' },
      operations(node({ parentNodeToken: null, nodeToken: 'wikcnRoot' }))
    )

    expect(result.resolution).toMatchObject({
      provider: 'feishu',
      connectionId: CONNECTION_ID,
      account: { userId: 'user-1', displayName: 'Ada' },
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      scope: { kind: 'space' },
      selected: {
        nodeId: 'wikcnRoot',
        remoteObjectId: 'doc-1',
        relativeBreadcrumb: ['Architecture'],
        originalUrl: 'https://acme.feishu.cn/wiki/wikcnRoot',
        documentKind: 'document',
        supportState: 'supported'
      }
    })
    expect(JSON.stringify(result)).not.toContain('credentialReference')
  })

  it('resolves Wiki nodes and direct Docx documents without trusting the input origin for API work', async () => {
    const wiki = operations()
    const docx = operations(node({ nodeToken: 'wiki-doc-node', objToken: 'doxcnDocument' }))

    await expect(
      resolveFeishuKnowledgeScope({ connection: connection(), url: 'https://acme.feishu.cn/wiki/wikcnNode' }, wiki)
    ).resolves.toMatchObject({ resolution: { scope: { kind: 'node', nodeId: 'wiki-node' } } })
    await expect(
      resolveFeishuKnowledgeScope({ connection: connection(), url: 'https://acme.feishu.cn/docx/doxcnDocument' }, docx)
    ).resolves.toMatchObject({
      resolution: { scope: { kind: 'document', nodeId: 'wiki-doc-node', remoteObjectId: 'doxcnDocument' } }
    })
  })

  it('rejects an invalid URL before any provider operation', async () => {
    const provider = operations()

    await expect(
      resolveFeishuKnowledgeScope(
        { connection: connection(), url: 'https://acme.larksuite.com/wiki/wikcnNode' },
        provider
      )
    ).rejects.toMatchObject({ code: 'invalid-scope-url' })
    expect(provider.getNode).not.toHaveBeenCalled()
  })

  it('rejects contradictory Docx identity instead of resolving a different provider object', async () => {
    await expect(
      resolveFeishuKnowledgeScope(
        { connection: connection(), url: 'https://acme.feishu.cn/docx/doxcnDocument' },
        operations(node({ objToken: 'different-token' }))
      )
    ).rejects.toMatchObject({ code: 'invalid-provider-response' })
  })
})
