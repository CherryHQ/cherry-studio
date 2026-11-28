import type { CherryMessagePart } from '@shared/data/types/message'

export const AGENT_SESSION_FOLLOWUPS_CACHE_KEY = (topicId: string) => `agent.session.followups.${topicId}` as const

export interface AgentSessionFollowup {
  id: string
  revision: number
  parts: CherryMessagePart[]
  editing?: true
}

export interface AgentSessionFollowupQueue {
  items: AgentSessionFollowup[]
  paused: boolean
}

export type AgentSessionFollowupChange =
  | { type: 'resume' }
  | { type: 'begin-edit'; inputId: string; revision: number; token: string }
  | { type: 'cancel-edit'; inputId: string; token: string }
  | { type: 'edit'; inputId: string; revision: number; token: string; parts: CherryMessagePart[] }
  | { type: 'reorder'; before: string[]; after: string[] }
  | { type: 'withdraw'; inputId: string }
  | { type: 'steer'; inputId: string }
