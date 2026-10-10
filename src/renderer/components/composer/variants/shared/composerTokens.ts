import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import {
  composerFileTokenIdFromSourceId,
  getComposerFileTokenSourceId
} from '@renderer/utils/message/composerFileTokenSource'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { McpResource } from '@shared/types/mcp'

import type { ComposerDraftToken, ComposerSerializedToken } from '../../tokens'

export const composerFileTokenId = (file: Pick<ComposerAttachment, 'fileTokenSourceId'>) => {
  const sourceId = getComposerFileTokenSourceId(file)
  if (!sourceId) {
    throw new Error('fileTokenSourceId is required to create a composer file token id')
  }
  return composerFileTokenIdFromSourceId(sourceId)
}

export const composerKnowledgeBaseTokenId = (base: Pick<KnowledgeBase, 'id'>) => `knowledge:${base.id}`

export function fileToComposerToken(file: ComposerAttachment): ComposerDraftToken {
  return {
    id: composerFileTokenId(file),
    kind: 'file',
    label: file.origin_name || file.name,
    payload: file
  }
}

/** Model-visible instruction: the scope part is dropped, while the attached base ID already identifies the search target. */
export function knowledgeBaseToComposerToken(base: KnowledgeBase): ComposerDraftToken {
  return {
    id: composerKnowledgeBaseTokenId(base),
    kind: 'knowledge',
    label: base.name,
    promptText: `The user attached knowledge base "${base.name}" (id: ${base.id}). Include "${base.id}" in kb_search baseIds before answering questions that may depend on this knowledge base, and cite relevant kb_search or kb_read results. Use kb_list only to browse its structure; kb_list output is not retrieved evidence.`,
    payload: base
  }
}

/** Keyed by server *id*, not name: server names carry no unique constraint, so two servers can
 *  publish the same uri under the same name and their chips would otherwise collide. */
export const composerMcpResourceTokenId = (resource: Pick<McpResource, 'serverId' | 'uri'>) =>
  `mcp-resource:${resource.serverId}:${resource.uri}`

/**
 * A picked MCP resource the composer did not inline — binary content, or text past
 * `MCP_RESOURCE_INLINE_MAX_CHARS`. Same contract as the knowledge token above: the
 * `(serverId, uri)` pair is load-bearing (it is exactly what `mcp_resource_read` takes), and the
 * sentence names the tool because nothing else tells the model the attachment exists.
 */
export function mcpResourceToComposerToken(
  resource: McpResource,
  options: { reader: 'mcp_resource_read' | 'runtime' } = { reader: 'mcp_resource_read' }
): ComposerDraftToken {
  const name = resource.name || resource.uri
  // Agent sessions reach resources through their own MCP bridge, so naming the chat builtin there
  // would point the model at a tool its runtime does not have.
  const instruction =
    options.reader === 'mcp_resource_read'
      ? `read it with mcp_resource_read using serverId "${resource.serverId}" and uri "${resource.uri}"`
      : `read it from MCP server "${resource.serverName}" at uri "${resource.uri}"`
  return {
    id: composerMcpResourceTokenId(resource),
    kind: 'reference',
    label: name,
    description: resource.uri,
    promptText: `The user attached MCP resource "${name}" from server "${resource.serverName}" — ${instruction}.`,
    payload: resource
  }
}

export function getComposerTokenIds(tokens: readonly ComposerSerializedToken[], kind?: ComposerDraftToken['kind']) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}

export function hasComposerToken(tokens: readonly ComposerSerializedToken[], id: string) {
  return tokens.some((token) => token.id === id)
}
