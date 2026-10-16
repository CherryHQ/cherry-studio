import { createHash } from 'node:crypto'

import { t } from '@main/i18n'
import { LEGACY_DSH_TOOL_PREFIX } from '@shared/ai/retiredAgentRuntime'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'

/** Read-only identity compatibility for disabled tools persisted by the retired runtime. */
export function legacyDisabledToolId(serverName: string, toolName: string): string {
  const wireName = `mcp__${serverName}__${toolName}`
  if (/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(wireName)) return `${LEGACY_DSH_TOOL_PREFIX}${wireName}`
  const prefix = `mcp__${toCamelCase(serverName)}__${toCamelCase(toolName)}`.replace(/[^A-Za-z0-9_-]/g, '')
  const hash = createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 12)
  const safePrefix = /^[A-Za-z_]/.test(prefix) ? prefix : `mcp_${prefix}`
  return `${LEGACY_DSH_TOOL_PREFIX}${safePrefix.slice(0, 50)}_${hash}`
}

export function assertLegacyDisabledToolsResolved(unresolved: ReadonlySet<string>): void {
  if (unresolved.size) throw new Error(t('agent.session.pi.legacy_tool_policy_unresolved'))
}
