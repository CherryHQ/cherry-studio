import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'
import type {
  ExternalKnowledgeDocumentKind,
  ExternalKnowledgeReadDescriptor,
  ExternalKnowledgeScopeResolution
} from '@shared/data/types/externalKnowledgeRead'

import type { FeishuWikiNode } from './feishuKnowledgeProvider'

const FEISHU_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

export type FeishuKnowledgeUrl = {
  kind: 'wiki' | 'docx'
  token: string
  originalUrl: string
}

export type FeishuKnowledgeReadErrorCode = 'invalid-scope-url' | 'invalid-provider-response'

export class FeishuKnowledgeReadError extends Error {
  constructor(readonly code: FeishuKnowledgeReadErrorCode) {
    super(`Feishu Knowledge read failed: ${code}`)
    this.name = 'FeishuKnowledgeReadError'
  }
}

export type FeishuKnowledgeReadOperations = {
  getNode(token: string, objType: 'wiki' | 'docx', signal?: AbortSignal): Promise<FeishuWikiNode>
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

function descriptor(node: FeishuWikiNode, originalUrl: string): ExternalKnowledgeReadDescriptor {
  const crossSpaceShortcut = node.nodeType === 'shortcut' && node.originSpaceId !== node.spaceId
  return {
    remoteObjectId: node.objToken,
    nodeId: node.nodeToken,
    parentNodeId: node.parentNodeToken,
    relativeBreadcrumb: [node.title],
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
    }
  }
}
