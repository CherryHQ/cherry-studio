import { loggerService } from '@logger'
import type { MCPServer } from '@types'

const logger = loggerService.withContext('ClaudeCodeMcp')

/**
 * Upper bound for probing a single configured MCP server while the agent is
 * starting. A slow remote server may legitimately take a few seconds, but it
 * must not be allowed to block the whole agent indefinitely.
 */
export const MCP_AGENT_PROBE_TIMEOUT_MS = 15_000

interface ProbeDeps {
  /** Resolve all configured MCP servers (addressable by `id` or `name`). */
  listServers: () => Promise<MCPServer[]>
  /** Probe a single server's connectivity. Must resolve (never reject). */
  checkConnectivity: (server: MCPServer) => Promise<boolean>
  /** Per-server probe timeout; defaults to {@link MCP_AGENT_PROBE_TIMEOUT_MS}. */
  timeoutMs?: number
}

/**
 * Filter the agent's configured MCP server ids down to the ones that are
 * actually reachable, probing each in parallel with a bounded timeout.
 *
 * A single unreachable or slow MCP server must not block the whole agent from
 * starting (graceful degradation — see issue #16242). Servers that fail to
 * connect within the probe window are skipped for this session; a later session
 * re-probes and can pick them back up once they recover.
 */
export async function filterReachableMcpServers(mcpIds: string[], deps: ProbeDeps): Promise<string[]> {
  if (mcpIds.length === 0) return []

  const timeoutMs = deps.timeoutMs ?? MCP_AGENT_PROBE_TIMEOUT_MS
  const servers = await deps.listServers()

  const results = await Promise.all(
    mcpIds.map(async (mcpId) => {
      const server = servers.find((s) => s.id === mcpId || s.name === mcpId)
      if (!server) {
        logger.warn('Configured MCP server not found; skipping for this session', { mcpId })
        return null
      }
      const reachable = await probeWithTimeout(() => deps.checkConnectivity(server), timeoutMs)
      if (!reachable) {
        logger.warn('MCP server failed to initialize; skipping for this session', { mcpId, name: server.name })
        return null
      }
      return mcpId
    })
  )

  const reachable = results.filter((id): id is string => id !== null)
  const skipped = mcpIds.length - reachable.length
  if (skipped > 0) {
    logger.warn('Skipped unavailable MCP servers during agent startup', { skipped, total: mcpIds.length })
  }
  return reachable
}

/**
 * Race a connectivity probe against a timeout, treating a timed-out probe as
 * unreachable (`false`). The probe is expected never to reject; if it lingers
 * past the timeout it simply loses the race and is left to settle on its own.
 */
async function probeWithTimeout(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([probe(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
