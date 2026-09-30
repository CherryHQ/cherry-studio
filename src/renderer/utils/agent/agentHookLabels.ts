import type { AgentHookEvent } from '@shared/ai/agentHook'

export const AGENT_HOOK_EVENT_LABEL_KEYS: Record<AgentHookEvent, string> = {
  sessionStart: 'agent_hooks.events.session_start',
  preToolUse: 'agent_hooks.events.pre_tool_use',
  postToolUse: 'agent_hooks.events.post_tool_use',
  postToolUseFailure: 'agent_hooks.events.post_tool_use_failure',
  questionRequested: 'agent_hooks.events.question_requested',
  approvalRequested: 'agent_hooks.events.approval_requested',
  turnEnd: 'agent_hooks.events.turn_end'
}
