import type { CherryMessagePart } from '@shared/data/types/message'

export const AGENT_SESSION_FOLLOWUPS_CACHE_KEY = (topicId: string) => `agent.session.followups.${topicId}` as const

export interface AgentSessionFollowup {
  id: string
  revision: number
  parts: CherryMessagePart[]
}

export type AgentSessionFollowupChange =
  | { type: 'edit'; inputId: string; revision: number; parts: CherryMessagePart[] }
  | { type: 'reorder'; before: string[]; after: string[] }
  | { type: 'withdraw'; inputId: string }
  | { type: 'steer'; inputId: string }
