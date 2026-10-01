import type { FeishuExternalKnowledgeScope } from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'
import type {
  ExternalKnowledgeDocumentRead,
  ExternalKnowledgeDocumentKind,
  ExternalKnowledgeReadDescriptor,
  ExternalKnowledgeScopePreview,
  ExternalKnowledgeScopeResolution
} from '@shared/data/types/externalKnowledgeRead'

import { FEISHU_KNOWLEDGE_TOKEN_PATTERN, type FeishuWikiNode } from './feishuKnowledgeProvider'

export type FeishuKnowledgeUrl = {
  kind: 'wiki' | 'docx'
  token: string
  originalUrl: string
}

export type FeishuKnowledgeReadErrorCode = 'invalid-scope-url' | 'invalid-provider-response' | 'unsupported-resource'

export class FeishuKnowledgeReadError extends Error {
  constructor(readonly code: FeishuKnowledgeReadErrorCode) {
    super(`Feishu Knowledge read failed: ${code}`)
    this.name = 'FeishuKnowledgeReadError'
  }
}

export type FeishuKnowledgeReadOperations = {
  getNode(token: string, objType: 'wiki' | 'docx', signal?: AbortSignal): Promise<FeishuWikiNode>
  listChildNodes(
    spaceId: string,
    parentNodeToken?: string,
    pageToken?: string,
    signal?: AbortSignal
  ): Promise<{ nodes: FeishuWikiNode[]; nextPageToken?: string }>
  getDocumentMarkdown(documentToken: string, signal?: AbortSignal): Promise<string>
}

export type FeishuKnowledgeNodeData = {
  spaceId: string
  nodeToken: string
  objToken: string
  objType: string
  nodeType: 'origin' | 'shortcut'
  originNodeToken: string | null
  originSpaceId: string | null
}

export type ResolvedFeishuKnowledgeScope = {
  resolution: ExternalKnowledgeScopeResolution
  providerData: FeishuKnowledgeNodeData
  selectedNode: FeishuWikiNode
}

export type FeishuKnowledgeReference = {
  descriptor: ExternalKnowledgeReadDescriptor
  providerData: FeishuKnowledgeNodeData
}

export type FeishuKnowledgeScopePreviewResult = {
  resolution: ExternalKnowledgeScopeResolution
  preview: ExternalKnowledgeScopePreview
  references: FeishuKnowledgeReference[]
}

export type FeishuKnowledgeSourceScanResult = {
  canonicalReferences: FeishuKnowledgeReference[]
  visibleNodeCount: number
  unsupportedOrSkippedCount: number
}

export type { FeishuWikiNode } from './feishuKnowledgeProvider'

function invalidScopeUrl(): never {
  throw new FeishuKnowledgeReadError('invalid-scope-url')
}

export function parseFeishuKnowledgeUrl(value: string): FeishuKnowledgeUrl {
  if (value.toLowerCase().includes('/../') || /%2e/i.test(value)) invalidScopeUrl()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalidScopeUrl()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) invalidScopeUrl()
  if (url.hostname !== 'feishu.cn' && !url.hostname.endsWith('.feishu.cn')) invalidScopeUrl()
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || (segments[0] !== 'wiki' && segments[0] !== 'docx')) invalidScopeUrl()
  const token = segments[1]
  if (!FEISHU_KNOWLEDGE_TOKEN_PATTERN.test(token)) invalidScopeUrl()
  const kind = segments[0]
  return { kind, token, originalUrl: `https://${url.hostname}/${kind}/${token}` }
}

function documentKind(objType: string): ExternalKnowledgeDocumentKind {
  switch (objType) {
    case 'docx':
      return 'document'
    case 'sheet':
      return 'spreadsheet'
    case 'bitable':
      return 'database'
    case 'slides':
      return 'presentation'
    case 'file':
      return 'file'
    default:
      return 'other'
  }
}

function wikiNodeUrl(hostname: string, nodeToken: string): string {
  return `https://${hostname}/wiki/${encodeURIComponent(nodeToken)}`
}

function descriptor(
  node: FeishuWikiNode,
  originalUrl: string,
  relativeBreadcrumb: string[] = [node.title]
): ExternalKnowledgeReadDescriptor {
  const crossSpaceShortcut = node.nodeType === 'shortcut' && node.originSpaceId !== node.spaceId
  return {
    remoteObjectId: node.objToken,
    nodeId: node.nodeToken,
    parentNodeId: node.parentNodeToken,
    relativeBreadcrumb,
    title: node.title,
    originalUrl,
    remoteRevision: node.objEditTime,
    documentKind: documentKind(node.objType),
    supportState: crossSpaceShortcut ? 'skipped' : node.objType === 'docx' ? 'supported' : 'unsupported'
  }
}

export async function resolveFeishuKnowledgeScope(
  input: { connection: ExternalKnowledgeConnection; url: string },
  operations: FeishuKnowledgeReadOperations,
  signal?: AbortSignal
): Promise<ResolvedFeishuKnowledgeScope> {
  const recognized = parseFeishuKnowledgeUrl(input.url)
  const node = await operations.getNode(recognized.token, recognized.kind, signal)
  if (recognized.kind === 'docx' && (node.objType !== 'docx' || node.objToken !== recognized.token)) {
    throw new FeishuKnowledgeReadError('invalid-provider-response')
  }
  const { accountUserId, displayName, tenantKey } = input.connection
  if (!accountUserId || !tenantKey) throw new FeishuKnowledgeReadError('invalid-provider-response')
  const selected = descriptor(node, recognized.originalUrl)
  const scope =
    recognized.kind === 'docx'
      ? { kind: 'document' as const, nodeId: node.nodeToken, remoteObjectId: node.objToken }
      : node.parentNodeToken === null
        ? { kind: 'space' as const }
        : { kind: 'node' as const, nodeId: node.nodeToken }
  return {
    resolution: {
      provider: 'feishu',
      connectionId: input.connection.id,
      account: { userId: accountUserId, displayName },
      tenantId: tenantKey,
      spaceId: node.spaceId,
      scope,
      selected
    },
    providerData: {
      spaceId: node.spaceId,
      nodeToken: node.nodeToken,
      objToken: node.objToken,
      objType: node.objType,
      nodeType: node.nodeType,
      originNodeToken: node.originNodeToken,
      originSpaceId: node.originSpaceId
    },
    selectedNode: node
  }
}

function providerData(node: FeishuWikiNode): FeishuKnowledgeNodeData {
  return {
    spaceId: node.spaceId,
    nodeToken: node.nodeToken,
    objToken: node.objToken,
    objType: node.objType,
    nodeType: node.nodeType,
    originNodeToken: node.originNodeToken,
    originSpaceId: node.originSpaceId
  }
}

function reference(node: FeishuWikiNode, originalUrl: string, breadcrumb: string[]): FeishuKnowledgeReference {
  return { descriptor: descriptor(node, originalUrl, breadcrumb), providerData: providerData(node) }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareCanonicalReferences(left: FeishuKnowledgeReference, right: FeishuKnowledgeReference): number {
  if (left.providerData.nodeType !== right.providerData.nodeType) {
    return left.providerData.nodeType === 'origin' ? -1 : 1
  }
  const leftBreadcrumb = left.descriptor.relativeBreadcrumb.map((segment) => segment.trim().normalize('NFC'))
  const rightBreadcrumb = right.descriptor.relativeBreadcrumb.map((segment) => segment.trim().normalize('NFC'))
  for (let index = 0; index < Math.min(leftBreadcrumb.length, rightBreadcrumb.length); index++) {
    const comparison = compareCodeUnits(leftBreadcrumb[index], rightBreadcrumb[index])
    if (comparison !== 0) return comparison
  }
  if (leftBreadcrumb.length !== rightBreadcrumb.length) return leftBreadcrumb.length - rightBreadcrumb.length
  return compareCodeUnits(left.descriptor.nodeId, right.descriptor.nodeId)
}

type TraversalEntry = {
  node: FeishuWikiNode
  breadcrumb: string[]
  ancestorNodeTokens: Set<string>
}

function shouldTraverse(node: FeishuWikiNode, selectedSpaceId: string): boolean {
  return (
    (node.nodeType === 'origin' && node.hasChild) ||
    (node.nodeType === 'shortcut' && node.originSpaceId === selectedSpaceId)
  )
}

async function traverseFeishuKnowledgeReferences(
  references: FeishuKnowledgeReference[],
  pending: TraversalEntry[],
  selectedSpaceId: string,
  originalUrlForNode: (nodeToken: string) => string,
  operations: FeishuKnowledgeReadOperations,
  signal?: AbortSignal
): Promise<void> {
  const originNodes = new Map<string, FeishuWikiNode>()
  for (const item of pending) {
    if (item.node.nodeType === 'origin') originNodes.set(item.node.nodeToken, item.node)
  }

  for (let index = 0; index < pending.length; index++) {
    const parent = pending[index]
    let traversalNode = parent.node
    if (parent.node.nodeType === 'shortcut') {
      const originNodeToken = parent.node.originNodeToken
      if (!originNodeToken) throw new FeishuKnowledgeReadError('invalid-provider-response')
      traversalNode = originNodes.get(originNodeToken) ?? (await operations.getNode(originNodeToken, 'wiki', signal))
      if (
        traversalNode.spaceId !== selectedSpaceId ||
        traversalNode.nodeToken !== originNodeToken ||
        traversalNode.nodeType !== 'origin' ||
        traversalNode.objToken !== parent.node.objToken ||
        traversalNode.objType !== parent.node.objType
      ) {
        throw new FeishuKnowledgeReadError('invalid-provider-response')
      }
      originNodes.set(originNodeToken, traversalNode)
      if (parent.ancestorNodeTokens.has(originNodeToken)) continue
    }
    if (!traversalNode.hasChild) continue
    const ancestorNodeTokens = new Set(parent.ancestorNodeTokens)
    ancestorNodeTokens.add(traversalNode.nodeToken)
    let pageToken: string | undefined
    const pageTokens = new Set<string>()
    const childNodeTokens = new Set<string>()
    do {
      const page = await operations.listChildNodes(selectedSpaceId, traversalNode.nodeToken, pageToken, signal)
      for (const child of page.nodes) {
        if (
          child.spaceId !== selectedSpaceId ||
          child.parentNodeToken !== traversalNode.nodeToken ||
          ancestorNodeTokens.has(child.nodeToken) ||
          childNodeTokens.has(child.nodeToken)
        ) {
          throw new FeishuKnowledgeReadError('invalid-provider-response')
        }
        childNodeTokens.add(child.nodeToken)
        if (child.nodeType === 'origin') originNodes.set(child.nodeToken, child)
        const breadcrumb = [...parent.breadcrumb, child.title]
        references.push(reference(child, originalUrlForNode(child.nodeToken), breadcrumb))
        if (shouldTraverse(child, selectedSpaceId)) {
          pending.push({ node: child, breadcrumb, ancestorNodeTokens })
        }
      }
      pageToken = page.nextPageToken
      if (pageToken && pageTokens.has(pageToken)) {
        throw new FeishuKnowledgeReadError('invalid-provider-response')
      }
      if (pageToken) pageTokens.add(pageToken)
    } while (pageToken)
  }
}

export async function previewFeishuKnowledgeScope(
  input: { connection: ExternalKnowledgeConnection; url: string },
  operations: FeishuKnowledgeReadOperations,
  signal?: AbortSignal
): Promise<FeishuKnowledgeScopePreviewResult> {
  const resolved = await resolveFeishuKnowledgeScope(input, operations, signal)
  const host = new URL(resolved.resolution.selected.originalUrl).hostname
  const selectedReference = reference(
    resolved.selectedNode,
    resolved.resolution.selected.originalUrl,
    resolved.resolution.selected.relativeBreadcrumb
  )
  const references = [selectedReference]
  const selectedSpaceId = resolved.resolution.spaceId
  const pending =
    resolved.resolution.scope.kind !== 'document' && shouldTraverse(resolved.selectedNode, selectedSpaceId)
      ? [
          {
            node: resolved.selectedNode,
            breadcrumb: resolved.resolution.selected.relativeBreadcrumb,
            ancestorNodeTokens: new Set<string>()
          }
        ]
      : []

  await traverseFeishuKnowledgeReferences(
    references,
    pending,
    selectedSpaceId,
    (nodeToken) => wikiNodeUrl(host, nodeToken),
    operations,
    signal
  )

  const supportedRemoteObjects = new Set<string>()
  let unsupportedOrSkippedCount = 0
  for (const item of references) {
    if (item.descriptor.supportState === 'supported') {
      supportedRemoteObjects.add(item.descriptor.remoteObjectId)
    } else {
      unsupportedOrSkippedCount++
    }
  }
  const supportedDocxCount = supportedRemoteObjects.size
  const preview: ExternalKnowledgeScopePreview = {
    resolution: resolved.resolution,
    visibleNodeCount: references.length,
    supportedDocxCount,
    unsupportedOrSkippedCount,
    embeddingCostExact: false,
    warnings: supportedDocxCount === 0 ? ['no-supported-documents'] : []
  }
  return { resolution: resolved.resolution, preview, references }
}

export async function scanFeishuKnowledgeSource(
  input: { spaceId: string; scope: FeishuExternalKnowledgeScope },
  operations: FeishuKnowledgeReadOperations,
  signal?: AbortSignal
): Promise<FeishuKnowledgeSourceScanResult> {
  const references: FeishuKnowledgeReference[] = []
  const pending: TraversalEntry[] = []
  if (input.scope.kind === 'space') {
    const rootNodeTokens = new Set<string>()
    const pageTokens = new Set<string>()
    let pageToken: string | undefined
    do {
      const page = await operations.listChildNodes(input.spaceId, undefined, pageToken, signal)
      for (const root of page.nodes) {
        if (root.spaceId !== input.spaceId || root.parentNodeToken !== null || rootNodeTokens.has(root.nodeToken)) {
          throw new FeishuKnowledgeReadError('invalid-provider-response')
        }
        rootNodeTokens.add(root.nodeToken)
        const breadcrumb = [root.title]
        references.push(reference(root, wikiNodeUrl('feishu.cn', root.nodeToken), breadcrumb))
        if (shouldTraverse(root, input.spaceId)) {
          pending.push({ node: root, breadcrumb, ancestorNodeTokens: new Set() })
        }
      }
      pageToken = page.nextPageToken
      if (pageToken && pageTokens.has(pageToken)) throw new FeishuKnowledgeReadError('invalid-provider-response')
      if (pageToken) pageTokens.add(pageToken)
    } while (pageToken)
  } else {
    const selected = await operations.getNode(input.scope.nodeId, 'wiki', signal)
    if (
      selected.spaceId !== input.spaceId ||
      selected.nodeToken !== input.scope.nodeId ||
      (input.scope.kind === 'document' &&
        (selected.objToken !== input.scope.remoteObjectId || selected.objType !== 'docx'))
    ) {
      throw new FeishuKnowledgeReadError('invalid-provider-response')
    }
    const breadcrumb = [selected.title]
    references.push(reference(selected, wikiNodeUrl('feishu.cn', selected.nodeToken), breadcrumb))
    if (input.scope.kind === 'node' && shouldTraverse(selected, input.spaceId)) {
      pending.push({ node: selected, breadcrumb, ancestorNodeTokens: new Set() })
    }
  }

  await traverseFeishuKnowledgeReferences(
    references,
    pending,
    input.spaceId,
    (nodeToken) => wikiNodeUrl('feishu.cn', nodeToken),
    operations,
    signal
  )

  const canonicalByRemoteObject = new Map<string, FeishuKnowledgeReference>()
  for (const item of references) {
    if (item.descriptor.supportState !== 'supported') continue
    const existing = canonicalByRemoteObject.get(item.descriptor.remoteObjectId)
    if (!existing || compareCanonicalReferences(item, existing) < 0) {
      canonicalByRemoteObject.set(item.descriptor.remoteObjectId, item)
    }
  }
  return {
    canonicalReferences: [...canonicalByRemoteObject.values()],
    visibleNodeCount: references.length,
    unsupportedOrSkippedCount:
      references.length - references.filter((item) => item.descriptor.supportState === 'supported').length
  }
}

export async function readFeishuDocx(
  item: FeishuKnowledgeReference,
  operations: FeishuKnowledgeReadOperations,
  signal?: AbortSignal
): Promise<ExternalKnowledgeDocumentRead> {
  if (item.descriptor.supportState !== 'supported' || item.providerData.objType !== 'docx') {
    throw new FeishuKnowledgeReadError('unsupported-resource')
  }
  const markdown = await operations.getDocumentMarkdown(item.providerData.objToken, signal)
  return {
    descriptor: item.descriptor,
    contentType: 'markdown',
    content: markdown.replace(/\r\n?/g, '\n')
  }
}
