import { createHash } from 'node:crypto'

import * as tinyPinyin from 'tiny-pinyin'

import { toCamelCase } from '@shared/ai/tools/mcpToolName'

const MCP_TOOL_ID_MAX_LENGTH = 63
const IDENTITY_DIGEST_LENGTH = 20

export type McpToolWireIdInput = {
  serverId: string
  serverName: string
  toolName: string
}

/** `tinyPinyin.parse` segment type for a Han character; everything else is passed through. */
const PINYIN_SEGMENT_HAN = 2

/**
 * `toCamelCase` drops non-ASCII, so a CJK name would slug to nothing and the
 * model would only see the digest. Romanize Han characters first — padded with
 * spaces so each syllable becomes its own camelCase word. `convertToPinyin` is
 * not usable here: it also splits ASCII runs character by character.
 *
 * ponytail: tiny-pinyin is already a dependency but covers Chinese only — kana
 * and Hangul still slug to nothing and fall back to the digest. Swap in
 * `transliteration` if Japanese/Korean MCP names need the same treatment.
 */
function toWireSlug(value: string): string {
  if (!tinyPinyin.isSupported()) return toCamelCase(value)
  const romanized = tinyPinyin
    .parse(value)
    .map((segment) => (segment.type === PINYIN_SEGMENT_HAN ? ` ${segment.target} ` : segment.source))
    .join('')
  return toCamelCase(romanized)
}

export function buildMcpToolWireId({ serverId, serverName, toolName }: McpToolWireIdInput): string {
  const serverPart = toWireSlug(serverName) || 'server'
  const toolPart = toWireSlug(toolName) || 'tool'
  const digest = createHash('sha256')
    .update(serverId)
    .update('\0')
    .update(toolName)
    .digest('hex')
    .slice(0, IDENTITY_DIGEST_LENGTH)
  const suffix = `_${digest}`
  const body = `mcp__${serverPart}__${toolPart}`.slice(0, MCP_TOOL_ID_MAX_LENGTH - suffix.length).replace(/_+$/, '')

  return `${body}${suffix}`
}
