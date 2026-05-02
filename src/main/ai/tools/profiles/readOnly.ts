import type { ToolProfile } from '../profile'
import { BuiltinToolNamespace, MetaToolName, ToolCapability } from '../types'

/**
 * Read-only profile for explore / researcher / plan-mode sub-agents.
 * MCP servers default to empty — caller adds trusted server ids per use case.
 */
export const READ_ONLY_PROFILE: ToolProfile = {
  allowNamespaces: [BuiltinToolNamespace.Web, BuiltinToolNamespace.Kb, BuiltinToolNamespace.Meta],
  allowCapabilities: [ToolCapability.Read],
  allowMcpServers: [],
  blockNames: [MetaToolName.Agent, MetaToolName.Exec, MetaToolName.Invoke]
}
