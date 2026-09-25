import { describe, expect, it, vi } from 'vitest'

import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

import {
  FeishuKnowledgeReadError,
  parseFeishuKnowledgeUrl,
  previewFeishuKnowledgeScope,
  readFeishuDocx,
  resolveFeishuKnowledgeScope,
  scanFeishuKnowledgeSource,
  type FeishuKnowledgeReadOperations,
  type FeishuWikiNode
} from '../feishuKnowledgeReadAdapter'

const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'

function connection(): ExternalKnowledgeConnection {
  return {
    id: CONNECTION_ID,
    provider: 'feishu',
    appCredentialSource: 'custom-app',
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
    authorizedAt: '2026-09-19T00:00:00.000Z',
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
  return {
    getNode: vi.fn().mockResolvedValue(value),
    listChildNodes: vi.fn().mockResolvedValue({ nodes: [] }),
    getDocumentMarkdown: vi.fn().mockResolvedValue('')
  }
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

describe('previewFeishuKnowledgeScope', () => {
  it('traverses the target subtree when a same-space shortcut is selected directly', async () => {
    const shortcut = node({
      nodeToken: 'selected-shortcut',
      objToken: 'target-doc',
      nodeType: 'shortcut',
      originNodeToken: 'target-origin',
      originSpaceId: 'space-1',
      title: 'Selected shortcut'
    })
    const target = node({
      nodeToken: 'target-origin',
      objToken: 'target-doc',
      parentNodeToken: 'outside-scope',
      title: 'Target origin',
      hasChild: true
    })
    const descendant = node({
      nodeToken: 'shortcut-descendant',
      objToken: 'descendant-doc',
      parentNodeToken: 'target-origin',
      title: 'Descendant'
    })
    const provider = operations(shortcut)
    vi.mocked(provider.getNode).mockImplementation(async (token) => {
      if (token === 'selected-shortcut') return shortcut
      if (token === 'target-origin') return target
      throw new Error(`Unexpected node lookup: ${token}`)
    })
    vi.mocked(provider.listChildNodes).mockImplementation(async (_spaceId, parentNodeToken) => {
      if (parentNodeToken === 'target-origin') return { nodes: [descendant] }
      throw new Error(`Unexpected traversal: ${parentNodeToken}`)
    })

    const result = await previewFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/selected-shortcut' },
      provider
    )

    expect(
      result.references.map(({ descriptor }) => ({
        nodeId: descriptor.nodeId,
        breadcrumb: descriptor.relativeBreadcrumb
      }))
    ).toEqual([
      { nodeId: 'selected-shortcut', breadcrumb: ['Selected shortcut'] },
      { nodeId: 'shortcut-descendant', breadcrumb: ['Selected shortcut', 'Descendant'] }
    ])
  })

  it('traverses a nested same-space shortcut using the shortcut-relative breadcrumb', async () => {
    const root = node({ nodeToken: 'root', objToken: 'root-doc', parentNodeToken: null, hasChild: true })
    const shortcut = node({
      nodeToken: 'nested-shortcut',
      objToken: 'target-doc',
      parentNodeToken: 'root',
      nodeType: 'shortcut',
      originNodeToken: 'target-origin',
      originSpaceId: 'space-1',
      title: 'Nested shortcut'
    })
    const target = node({
      nodeToken: 'target-origin',
      objToken: 'target-doc',
      parentNodeToken: 'outside-scope',
      title: 'Target origin',
      hasChild: true
    })
    const descendant = node({
      nodeToken: 'shortcut-descendant',
      objToken: 'descendant-doc',
      parentNodeToken: 'target-origin',
      title: 'Descendant'
    })
    const provider = operations(root)
    vi.mocked(provider.getNode).mockImplementation(async (token) => {
      if (token === 'root') return root
      if (token === 'target-origin') return target
      throw new Error(`Unexpected node lookup: ${token}`)
    })
    vi.mocked(provider.listChildNodes).mockImplementation(async (_spaceId, parentNodeToken) => {
      if (parentNodeToken === 'root') return { nodes: [shortcut] }
      if (parentNodeToken === 'target-origin') return { nodes: [descendant] }
      throw new Error(`Unexpected traversal: ${parentNodeToken}`)
    })

    const result = await previewFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/root' },
      provider
    )

    expect(result.references.at(-1)?.descriptor).toMatchObject({
      nodeId: 'shortcut-descendant',
      relativeBreadcrumb: ['Architecture', 'Nested shortcut', 'Descendant']
    })
  })

  it('retains a visible shortcut without re-entering an origin already on its traversal path', async () => {
    const root = node({ nodeToken: 'root', objToken: 'root-doc', parentNodeToken: null, hasChild: true })
    const shortcutToRoot = node({
      nodeToken: 'shortcut-to-root',
      objToken: 'root-doc',
      parentNodeToken: 'root',
      nodeType: 'shortcut',
      originNodeToken: 'root',
      originSpaceId: 'space-1',
      title: 'Back to root',
      hasChild: true
    })
    const provider = operations(root)
    vi.mocked(provider.listChildNodes).mockResolvedValue({ nodes: [shortcutToRoot] })

    const result = await previewFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/root' },
      provider
    )

    expect(result.references.map(({ descriptor }) => descriptor.nodeId)).toEqual(['root', 'shortcut-to-root'])
  })

  it('traverses every page and descendant without following a cross-space shortcut', async () => {
    const root = node({ nodeToken: 'root', objToken: 'doc-root', parentNodeToken: null, hasChild: true })
    const unsupportedParent = node({
      nodeToken: 'sheet-parent',
      objToken: 'sheet-1',
      objType: 'sheet',
      parentNodeToken: 'root',
      title: 'Unsupported parent',
      hasChild: true
    })
    const crossSpace = node({
      nodeToken: 'cross-shortcut',
      objToken: 'doc-cross',
      parentNodeToken: 'root',
      nodeType: 'shortcut',
      originNodeToken: 'origin-cross',
      originSpaceId: 'other-space',
      title: 'Cross-space shortcut',
      hasChild: true
    })
    const duplicateShortcut = node({
      nodeToken: 'same-space-shortcut',
      objToken: 'doc-root',
      parentNodeToken: 'root',
      nodeType: 'shortcut',
      originNodeToken: 'root',
      originSpaceId: 'space-1',
      title: 'Root shortcut'
    })
    const secondDocument = node({
      nodeToken: 'second-doc',
      objToken: 'doc-2',
      parentNodeToken: 'root',
      title: 'Second document'
    })
    const nestedDocument = node({
      nodeToken: 'nested-doc',
      objToken: 'doc-3',
      parentNodeToken: 'sheet-parent',
      title: 'Nested document'
    })
    const listChildNodes = vi.fn(async (_spaceId: string, parentNodeToken: string, pageToken?: string) => {
      if (parentNodeToken === 'root' && pageToken === undefined) {
        return { nodes: [unsupportedParent, crossSpace], nextPageToken: 'page-2' }
      }
      if (parentNodeToken === 'root' && pageToken === 'page-2') {
        return { nodes: [duplicateShortcut, secondDocument] }
      }
      if (parentNodeToken === 'sheet-parent' && pageToken === undefined) {
        return { nodes: [nestedDocument] }
      }
      throw new Error(`Unexpected traversal outside the selected space: ${parentNodeToken}`)
    })

    const result = await previewFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/root' },
      { ...operations(root), listChildNodes }
    )

    expect(result.preview).toEqual({
      resolution: result.resolution,
      visibleNodeCount: 6,
      supportedDocxCount: 3,
      unsupportedOrSkippedCount: 2,
      embeddingCostExact: false,
      warnings: []
    })
    expect(result.references.map(({ descriptor }) => descriptor.nodeId)).toEqual([
      'root',
      'sheet-parent',
      'cross-shortcut',
      'same-space-shortcut',
      'second-doc',
      'nested-doc'
    ])
  })

  it('returns a warning instead of failing when the selected scope contains no Docx objects', async () => {
    const root = node({
      nodeToken: 'root',
      objToken: 'sheet-root',
      objType: 'sheet',
      parentNodeToken: null,
      hasChild: true
    })
    const child = node({
      nodeToken: 'child',
      objToken: 'file-child',
      objType: 'file',
      parentNodeToken: 'root'
    })

    const result = await previewFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/root' },
      { ...operations(root), listChildNodes: vi.fn().mockResolvedValue({ nodes: [child] }) }
    )

    expect(result.preview).toMatchObject({
      visibleNodeCount: 2,
      supportedDocxCount: 0,
      unsupportedOrSkippedCount: 2,
      embeddingCostExact: false,
      warnings: ['no-supported-documents']
    })
  })

  it('rejects children whose provider identity contradicts the requested parent or selected space', async () => {
    const root = node({ nodeToken: 'root', objToken: 'doc-root', parentNodeToken: null, hasChild: true })

    await expect(
      previewFeishuKnowledgeScope(
        { connection: connection(), url: 'https://acme.feishu.cn/wiki/root' },
        {
          ...operations(root),
          listChildNodes: vi.fn().mockResolvedValue({
            nodes: [node({ nodeToken: 'child', parentNodeToken: 'wrong-parent', spaceId: 'other-space' })]
          })
        }
      )
    ).rejects.toMatchObject({ code: 'invalid-provider-response' })
  })

  it('rejects a repeated pagination token instead of continuing an unbounded traversal', async () => {
    const root = node({ nodeToken: 'root', objToken: 'doc-root', parentNodeToken: null, hasChild: true })
    const listChildNodes = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [], nextPageToken: 'same-page' })
      .mockResolvedValueOnce({ nodes: [], nextPageToken: 'same-page' })
      .mockRejectedValueOnce(new Error('pagination continued after the repeated token'))

    await expect(
      previewFeishuKnowledgeScope(
        { connection: connection(), url: 'https://acme.feishu.cn/wiki/root' },
        { ...operations(root), listChildNodes }
      )
    ).rejects.toMatchObject({ code: 'invalid-provider-response' })
  })
})

describe('scanFeishuKnowledgeSource', () => {
  it('enumerates every paginated space root before traversing their descendants', async () => {
    const firstRoot = node({ nodeToken: 'root-a', objToken: 'doc-a', parentNodeToken: null, hasChild: true })
    const secondRoot = node({ nodeToken: 'root-b', objToken: 'doc-b', parentNodeToken: null })
    const child = node({ nodeToken: 'child-a', objToken: 'doc-child', parentNodeToken: 'root-a' })
    const listChildNodes = vi.fn(async (_spaceId: string, parentNodeToken?: string, pageToken?: string) => {
      if (parentNodeToken === undefined && pageToken === undefined) {
        return { nodes: [firstRoot], nextPageToken: 'roots-2' }
      }
      if (parentNodeToken === undefined && pageToken === 'roots-2') return { nodes: [secondRoot] }
      if (parentNodeToken === 'root-a' && pageToken === undefined) return { nodes: [child] }
      throw new Error(`Unexpected traversal: ${parentNodeToken ?? 'root'}:${pageToken ?? 'first'}`)
    })

    const result = await scanFeishuKnowledgeSource(
      { spaceId: 'space-1', scope: { kind: 'space' } },
      { ...operations(), listChildNodes }
    )

    expect(result).toMatchObject({ visibleNodeCount: 3, unsupportedOrSkippedCount: 0 })
    expect(result.canonicalReferences.map(({ descriptor }) => descriptor.nodeId)).toEqual([
      'root-a',
      'root-b',
      'child-a'
    ])
    expect(listChildNodes.mock.calls.slice(0, 2).map((call) => call.slice(1, 3))).toEqual([
      [undefined, undefined],
      [undefined, 'roots-2']
    ])
  })

  it('re-resolves a stored node identity and emits only a stable canonical Feishu URL', async () => {
    const storedNode = node({ nodeToken: 'stored-node', objToken: 'doc-stored', parentNodeToken: 'parent' })
    const provider = operations(storedNode)

    const result = await scanFeishuKnowledgeSource(
      { spaceId: 'space-1', scope: { kind: 'node', nodeId: 'stored-node' } },
      provider
    )

    expect(result.canonicalReferences).toEqual([
      expect.objectContaining({
        descriptor: expect.objectContaining({
          nodeId: 'stored-node',
          remoteObjectId: 'doc-stored',
          originalUrl: 'https://feishu.cn/wiki/stored-node'
        })
      })
    ])
    expect(provider.getNode).toHaveBeenCalledWith('stored-node', 'wiki', undefined)
  })

  it('encodes provider node tokens when constructing canonical Feishu URLs', async () => {
    const malformedToken = '../docx/other?#fragment'
    const provider = operations()
    vi.mocked(provider.listChildNodes).mockResolvedValue({
      nodes: [node({ nodeToken: malformedToken, parentNodeToken: null })]
    })

    const result = await scanFeishuKnowledgeSource({ spaceId: 'space-1', scope: { kind: 'space' } }, provider)

    expect(result.canonicalReferences[0].descriptor.originalUrl).toBe(
      `https://feishu.cn/wiki/${encodeURIComponent(malformedToken)}`
    )
  })

  it.each([
    {
      name: 'node token',
      input: { spaceId: 'space-1', scope: { kind: 'node' as const, nodeId: 'stored-node' } },
      resolved: node({ nodeToken: 'different-node' })
    },
    {
      name: 'space',
      input: { spaceId: 'space-1', scope: { kind: 'node' as const, nodeId: 'stored-node' } },
      resolved: node({ nodeToken: 'stored-node', spaceId: 'other-space' })
    },
    {
      name: 'document object',
      input: {
        spaceId: 'space-1',
        scope: { kind: 'document' as const, nodeId: 'stored-node', remoteObjectId: 'stored-doc' }
      },
      resolved: node({ nodeToken: 'stored-node', objToken: 'different-doc' })
    },
    {
      name: 'document type',
      input: {
        spaceId: 'space-1',
        scope: { kind: 'document' as const, nodeId: 'stored-node', remoteObjectId: 'stored-doc' }
      },
      resolved: node({ nodeToken: 'stored-node', objToken: 'stored-doc', objType: 'sheet' })
    }
  ])('rejects a stored scope whose $name identity contradicts the provider', async ({ input, resolved }) => {
    await expect(scanFeishuKnowledgeSource(input, operations(resolved))).rejects.toMatchObject({
      code: 'invalid-provider-response'
    })
  })

  it('prefers an in-scope origin over an earlier shortcut for the same Docx object', async () => {
    const root = node({
      nodeToken: 'root',
      objToken: 'sheet-root',
      objType: 'sheet',
      parentNodeToken: null,
      hasChild: true
    })
    const shortcut = node({
      nodeToken: 'shortcut-doc',
      objToken: 'shared-doc',
      parentNodeToken: 'root',
      nodeType: 'shortcut',
      originNodeToken: 'origin-doc',
      originSpaceId: 'space-1',
      title: 'A Shortcut'
    })
    const origin = node({
      nodeToken: 'origin-doc',
      objToken: 'shared-doc',
      parentNodeToken: 'root',
      title: 'Z Origin'
    })
    const provider = operations()
    vi.mocked(provider.listChildNodes).mockImplementation(async (_spaceId, parentNodeToken) =>
      parentNodeToken === undefined ? { nodes: [root] } : { nodes: [shortcut, origin] }
    )

    const result = await scanFeishuKnowledgeSource({ spaceId: 'space-1', scope: { kind: 'space' } }, provider)

    expect(result).toMatchObject({ visibleNodeCount: 3, unsupportedOrSkippedCount: 1 })
    expect(result.canonicalReferences).toHaveLength(1)
    expect(result.canonicalReferences[0].descriptor.nodeId).toBe('origin-doc')
  })

  it('chooses shortcut canonicals by trimmed NFC breadcrumbs and then node id in code-unit order', async () => {
    const root = node({
      nodeToken: 'root',
      objToken: 'sheet-root',
      objType: 'sheet',
      parentNodeToken: null,
      hasChild: true
    })
    const shortcut = (nodeToken: string, objToken: string, originNodeToken: string, title: string) =>
      node({
        nodeToken,
        objToken,
        parentNodeToken: 'root',
        nodeType: 'shortcut',
        originNodeToken,
        originSpaceId: 'space-1',
        title
      })
    const children = [
      shortcut('codeunit-apple', 'codeunit-doc', 'codeunit-origin', 'apple'),
      shortcut('codeunit-zebra', 'codeunit-doc', 'codeunit-origin', 'Zebra'),
      shortcut('trim-z', 'trim-doc', 'trim-origin', '  Beta'),
      shortcut('trim-a', 'trim-doc', 'trim-origin', 'Alpha  '),
      shortcut('nfc-z', 'nfc-doc', 'nfc-origin', 'Cafe\u0301'),
      shortcut('nfc-a', 'nfc-doc', 'nfc-origin', 'Café')
    ]
    const provider = operations()
    vi.mocked(provider.listChildNodes).mockImplementation(async (_spaceId, parentNodeToken) =>
      parentNodeToken === undefined ? { nodes: [root] } : { nodes: children }
    )
    vi.mocked(provider.getNode).mockImplementation(async (nodeToken) => {
      if (nodeToken === 'codeunit-origin') {
        return node({ nodeToken, objToken: 'codeunit-doc', title: 'Hidden code-unit origin' })
      }
      if (nodeToken === 'trim-origin') return node({ nodeToken, objToken: 'trim-doc', title: 'Hidden trim origin' })
      if (nodeToken === 'nfc-origin') return node({ nodeToken, objToken: 'nfc-doc', title: 'Hidden NFC origin' })
      throw new Error(`Unexpected node lookup: ${nodeToken}`)
    })

    const result = await scanFeishuKnowledgeSource({ spaceId: 'space-1', scope: { kind: 'space' } }, provider)

    expect(result.canonicalReferences.map(({ descriptor }) => descriptor.nodeId)).toEqual([
      'codeunit-zebra',
      'trim-a',
      'nfc-a'
    ])
  })

  it('fails the whole scan when a later space-root page fails', async () => {
    const failure = new Error('root pagination failed')
    const provider = operations()
    vi.mocked(provider.listChildNodes)
      .mockResolvedValueOnce({ nodes: [], nextPageToken: 'roots-2' })
      .mockRejectedValueOnce(failure)

    await expect(scanFeishuKnowledgeSource({ spaceId: 'space-1', scope: { kind: 'space' } }, provider)).rejects.toBe(
      failure
    )
  })

  it('fails the whole scan when traversal under any space root fails', async () => {
    const failure = new Error('root traversal failed')
    const root = node({ nodeToken: 'root', parentNodeToken: null, hasChild: true })
    const provider = operations()
    vi.mocked(provider.listChildNodes)
      .mockResolvedValueOnce({ nodes: [root] })
      .mockRejectedValueOnce(failure)

    await expect(scanFeishuKnowledgeSource({ spaceId: 'space-1', scope: { kind: 'space' } }, provider)).rejects.toBe(
      failure
    )
  })
})

describe('readFeishuDocx', () => {
  it('normalizes transport newlines without prepending the Wiki title or changing provider Markdown', async () => {
    const provider = operations()
    vi.mocked(provider.getDocumentMarkdown).mockResolvedValue(
      '---\r\ntitle: Provider frontmatter\r\n---\r\n{{unsupported_widget}}\rLast line'
    )
    const resolved = await resolveFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/docx/doc-1' },
      provider
    )

    await expect(readFeishuDocx(referenceFrom(resolved), provider)).resolves.toEqual({
      descriptor: resolved.resolution.selected,
      contentType: 'markdown',
      content: '---\ntitle: Provider frontmatter\n---\n{{unsupported_widget}}\nLast line'
    })
  })

  it('rejects unsupported metadata before requesting any document body', async () => {
    const provider = operations(node({ objType: 'sheet', objToken: 'sheet-1' }))
    const resolved = await resolveFeishuKnowledgeScope(
      { connection: connection(), url: 'https://acme.feishu.cn/wiki/wiki-node' },
      provider
    )

    await expect(readFeishuDocx(referenceFrom(resolved), provider)).rejects.toMatchObject({
      code: 'unsupported-resource'
    })
    expect(provider.getDocumentMarkdown).not.toHaveBeenCalled()
  })
})

function referenceFrom(resolved: Awaited<ReturnType<typeof resolveFeishuKnowledgeScope>>) {
  return { descriptor: resolved.resolution.selected, providerData: resolved.providerData }
}
