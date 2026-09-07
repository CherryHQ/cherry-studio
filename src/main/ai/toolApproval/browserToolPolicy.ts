import { application } from '@application'
import { BROWSER_TOOL_NAMES, browserToolFromRuntimeName } from '@shared/ai/browserTools'

export function resolveBrowserToolPermission(runtimeName: string) {
  const toolName = browserToolFromRuntimeName(runtimeName)
  if (!toolName) return undefined
  const preferences = application.get('PreferenceService')
  if (!preferences.get('app.browser.agent_control.enabled')) return 'deny'
  const permission = preferences.get('app.browser.tool_permissions')[toolName]
  return permission === 'allow' || permission === 'deny' ? permission : 'ask'
}

export function browserRuntimeNamesWithPermission(permission: 'ask' | 'allow' | 'deny'): string[] {
  return BROWSER_TOOL_NAMES.map((name) => `mcp__browser__${name}`).filter(
    (name) => resolveBrowserToolPermission(name) === permission
  )
}
