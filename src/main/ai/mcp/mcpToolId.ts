import { createHash } from 'node:crypto'

import {
  formatMcpRuntimeName,
  formatMcpServerWireName,
  formatMcpToolWireName,
  MCP_TOOL_DIGEST_LENGTH
} from '@shared/ai/tools/mcpToolIdentity'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'
import * as tinyPinyin from 'tiny-pinyin'

const MCP_TOOL_ID_MAX_LENGTH = 63
const LEGACY_DIGEST_LENGTH = 20

export type McpToolWireIdInput = {
  serverId: string
  serverName: string
  toolName: string
}

export type McpToolIdentityInput = {
  serverId: string
  toolName: string
}

export type McpServerWireNameInput = {
  serverId: string
  serverName: string
}

export type McpToolRuntimeNameInput = McpToolIdentityInput & {
  serverWireName: string
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function buildMcpToolIdentityKey({ serverId, toolName }: McpToolIdentityInput): string {
  return sha256(`${serverId}\0${toolName}`)
}

export function buildMcpServerWireName({ serverId, serverName }: McpServerWireNameInput): string {
  return formatMcpServerWireName(toWireSlug(serverName), sha256(serverId).slice(0, MCP_TOOL_DIGEST_LENGTH))
}

export function buildMcpToolWireName({ serverId, toolName }: McpToolIdentityInput): string {
  return formatMcpToolWireName(
    toWireSlug(toolName),
    buildMcpToolIdentityKey({ serverId, toolName }).slice(0, MCP_TOOL_DIGEST_LENGTH)
  )
}

export function buildMcpToolRuntimeName({ serverId, serverWireName, toolName }: McpToolRuntimeNameInput): string {
  return formatMcpRuntimeName(serverWireName, buildMcpToolWireName({ serverId, toolName }))
}

export function buildMcpToolWireId({ serverId, serverName, toolName }: McpToolWireIdInput): string {
  const serverPart = toWireSlug(serverName) || 'server'
  const toolPart = toWireSlug(toolName) || 'tool'
  const digest = buildMcpToolIdentityKey({ serverId, toolName }).slice(0, LEGACY_DIGEST_LENGTH)
  const suffix = `_${digest}`
  const body = `mcp__${serverPart}__${toolPart}`.slice(0, MCP_TOOL_ID_MAX_LENGTH - suffix.length).replace(/_+$/, '')

  return `${body}${suffix}`
}
