export type ManagedToolStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ManagedToolStatusState {
  status: ManagedToolStatus
  url?: string
}

export interface CodeBuddyWebUiStatus extends ManagedToolStatusState {
  owned: boolean
}

export const LOCAL_AGENT_WEB_UI_IDS = ['opencode', 'kimi', 'qwen', 'kilo'] as const
export type LocalAgentWebUiId = (typeof LOCAL_AGENT_WEB_UI_IDS)[number]
