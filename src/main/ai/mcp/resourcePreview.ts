/**
 * Bounded resource read for the composer.
 *
 * The renderer only needs enough of a resource to decide between inlining it and attaching a
 * reference, so the cap belongs here rather than after the whole payload has crossed IPC: a
 * multi-megabyte resource used to be serialized into the renderer in full just to be discarded.
 */

import { application } from '@application'
import type { McpResource } from '@shared/types/mcp'

export interface McpResourcePreview {
  /** Text content, capped at the requested length. Empty for a binary resource. */
  text: string
  /** Full length of the text content, so the caller can tell it was capped. */
  totalChars: number
  mimeType?: string
  /** True when the resource carries blob content — there is no text form to inline. */
  isBinary: boolean
}

export async function readMcpResourcePreview({
  serverId,
  uri,
  maxChars
}: {
  serverId: string
  uri: string
  maxChars: number
}): Promise<McpResourcePreview> {
  const { contents } = await application.get('McpRuntimeService').getResource({ serverId, uri })
  const text = contents
    .map((content: McpResource) => content.text ?? '')
    .filter(Boolean)
    .join('\n')

  return {
    text: text.slice(0, maxChars),
    totalChars: text.length,
    mimeType: contents[0]?.mimeType,
    isBinary: !text && contents.some((content: McpResource) => !!content.blob)
  }
}
