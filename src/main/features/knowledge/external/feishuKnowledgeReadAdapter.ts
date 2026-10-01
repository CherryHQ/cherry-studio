import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'
import type {
  ExternalKnowledgeDocumentRead,
  ExternalKnowledgeDocumentKind,
  ExternalKnowledgeReadDescriptor,
  ExternalKnowledgeScopePreview,
  ExternalKnowledgeScopeResolution
} from '@shared/data/types/externalKnowledgeRead'

import type { FeishuWikiNode } from './feishuKnowledgeProvider'

const FEISHU_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

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
    parentNodeToken: string,
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
  if (!FEISHU_TOKEN_PATTERN.test(token)) invalidScopeUrl()
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
  const originNodes = new Map<string, FeishuWikiNode>()
  if (resolved.selectedNode.nodeType === 'origin') {
    originNodes.set(resolved.selectedNode.nodeToken, resolved.selectedNode)
  }
  const pending =
    resolved.resolution.scope.kind !== 'document' &&
    ((resolved.selectedNode.nodeType === 'origin' && resolved.selectedNode.hasChild) ||
      (resolved.selectedNode.nodeType === 'shortcut' && resolved.selectedNode.originSpaceId === selectedSpaceId))
      ? [
          {
            node: resolved.selectedNode,
            breadcrumb: resolved.resolution.selected.relativeBreadcrumb,
            ancestorNodeTokens: new Set<string>()
          }
        ]
      : []

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
        references.push(reference(child, `https://${host}/wiki/${child.nodeToken}`, breadcrumb))
        if (
          (child.nodeType === 'origin' && child.hasChild) ||
          (child.nodeType === 'shortcut' && child.originSpaceId === selectedSpaceId)
        ) {
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
