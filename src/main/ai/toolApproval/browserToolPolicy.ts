import { application } from '@application'
import { BROWSER_TOOL_NAMES, browserToolFromRuntimeName } from '@main/ai/mcp/browserTools'

import type { BuiltinToolPolicyEntry } from './builtinToolPolicyRegistry'

export function resolveBrowserToolPermission(runtimeName: string) {
  const toolName = browserToolFromRuntimeName(runtimeName)
  if (!toolName) return undefined
  const preferences = application.get('PreferenceService')
  return preferences.get('app.browser.agent_control.enabled') ? 'allow' : 'deny'
}

export function listBrowserToolPolicies(): BuiltinToolPolicyEntry[] {
  return BROWSER_TOOL_NAMES.map((name) => ({
    serverName: 'browser',
    toolName: name,
    approval: resolveBrowserToolPermission(`mcp__browser__${name}`) === 'allow' ? 'auto' : 'required',
    bypassApproval: 'lift'
  }))
}
