import { type AgentPermissionMode, normalizeLegacyPermissionMode } from '@cherrystudio/agent-permission'

export type ClaudeSdkPermissionMode = 'default' | 'bypassPermissions'

/** Product modes deliberately collapse to the two SDK modes Cherry can safely control. */
export function toSdkPermissionMode(mode: AgentPermissionMode | string | null | undefined): ClaudeSdkPermissionMode {
  return normalizeLegacyPermissionMode(mode) === 'full' ? 'bypassPermissions' : 'default'
}
