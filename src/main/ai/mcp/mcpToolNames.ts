import { createHash } from 'node:crypto'

/** Provider contract for this path: `mcp__<server>__<tool>` must be <= 64 characters. */
export const CLAUDE_MCP_TOOL_NAME_MAX_LENGTH = 64

/** Mirrors the pinned CLI's sanitizer: everything outside [A-Za-z0-9_-] becomes '_'. */
export function sanitizeClaudeMcpNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

export interface ClaudeMcpServerIdentity {
  /** Canonical stored server id (stable identity used for hashing). */
  serverId: string
  /** The SDK record key the runtime would use without bounded naming. */
  sdkServerKey: string
}

export interface ClaudeMcpToolNamePlan {
  serverKey: string
  toolName(originalToolName: string): string
  resolve(runtimeName: string): { serverId: string; toolName: string } | undefined
}

export function planClaudeMcpToolNames(
  identity: ClaudeMcpServerIdentity,
  originalToolNames: readonly string[]
): ClaudeMcpToolNamePlan {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const sanitizedKey = sanitizeClaudeMcpNameSegment(identity.sdkServerKey)
  const serverKey = sanitizedKey.length <= 44 ? sanitizedKey : `s_${hash(identity.serverId).slice(0, 20)}`
  const toolBudget = CLAUDE_MCP_TOOL_NAME_MAX_LENGTH - 5 - 2 - serverKey.length
  const toolName = (original: string): string => {
    const sanitized = sanitizeClaudeMcpNameSegment(original)
    return sanitized.length <= toolBudget
      ? sanitized
      : `${sanitized.slice(0, toolBudget - 13)}_${hash(`${identity.serverId}\0${original}`).slice(0, 12)}`
  }
  const originals = new Map<string, string>()
  for (const original of originalToolNames) {
    const alias = toolName(original)
    const previous = originals.get(alias)
    if (previous !== undefined && previous !== original) {
      throw new Error(
        `Claude MCP tool name collision on server ${identity.serverId}: ${previous} and ${original} map to ${alias}`
      )
    }
    originals.set(alias, original)
  }
  return {
    serverKey,
    toolName,
    resolve(runtimeName) {
      const original = originals.get(runtimeName)
      return original === undefined ? undefined : { serverId: identity.serverId, toolName: original }
    }
  }
}
