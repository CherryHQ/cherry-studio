import { loggerService } from '@logger'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { isAgentSelectionAction, type SelectionAction, SelectionActionSchema } from '@shared/types/selection'

const logger = loggerService.withContext('selectionAction')

/** Narrows stored action items; an item that does not parse is skipped so the rest stay usable. */
export function parseSelectionActions(items: readonly SelectionActionItem[]): SelectionAction[] {
  return items.flatMap((item) => {
    const result = SelectionActionSchema.safeParse(item)
    if (result.success) return [result.data]
    logger.warn('Skipping an invalid selection action', { id: item.id, issues: result.error.issues })
    return []
  })
}

/** A custom action's prompt with the selection filled in: `{{text}}` marks its place, otherwise it follows the prompt. */
export function expandSelectionPrompt(prompt: string | undefined, selectedText: string): string {
  if (!prompt) return selectedText
  if (prompt.includes('{{text}}')) return prompt.replaceAll('{{text}}', () => selectedText)
  return prompt + '\n\n' + selectedText
}

export type SelectionActionAgentIssue = 'no_model' | 'agent_unavailable'

/** Short cause shown on the toolbar button and the settings list row. */
export const SELECTION_AGENT_ISSUE_LABEL_KEYS = {
  no_model: 'selection.action.agent_issue.no_model',
  agent_unavailable: 'selection.action.agent_issue.agent_unavailable'
} as const satisfies Record<SelectionActionAgentIssue, string>

/** Full cause and fix shown next to an agent picker. */
export const SELECTION_AGENT_ISSUE_HINT_KEYS = {
  no_model: 'selection.settings.agent_issue.no_model',
  agent_unavailable: 'selection.settings.agent_issue.agent_unavailable'
} as const satisfies Record<SelectionActionAgentIssue, string>

/** Why a resolved agent id cannot run: it no longer exists, or its model is unset or deleted. */
export function getSelectionAgentIssue(agent: AgentEntity | undefined): SelectionActionAgentIssue | null {
  if (!agent) return 'agent_unavailable'
  // `modelName` is resolved at read time and is null once the model or its provider is deleted.
  return agent.model && agent.modelName ? null : 'no_model'
}

export interface SelectionActionAgent {
  /** Undefined when the agent does not exist. */
  agent: AgentEntity | undefined
  issue: SelectionActionAgentIssue | null
}

/**
 * Resolves the agent an action runs on, or null when the action does not run on an agent.
 * An unbound `ask-agent` uses Cherry Assistant and stays usable while it is missing, because sending recreates it.
 */
export function getSelectionActionAgent(
  action: SelectionAction,
  agents: readonly AgentEntity[]
): SelectionActionAgent | null {
  if (!isAgentSelectionAction(action)) return null

  if (action.isBuiltIn && !action.agentId) {
    const agent = agents.find((candidate) => candidate.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT)
    return { agent, issue: agent ? getSelectionAgentIssue(agent) : null }
  }

  const agent = action.agentId ? agents.find((candidate) => candidate.id === action.agentId) : undefined
  return { agent, issue: getSelectionAgentIssue(agent) }
}
