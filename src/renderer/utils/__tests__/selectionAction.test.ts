import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { AskAgentSelectionAction, CustomSelectionAction } from '@shared/types/selection'

import { getSelectionActionAgent, parseSelectionActions } from '../selectionAction'

describe('parseSelectionActions', () => {
  it('keeps valid actions when one stored item is broken', () => {
    const items: SelectionActionItem[] = [
      { id: 'copy', name: 'selection.action.builtin.copy', enabled: true, isBuiltIn: true },
      { id: 'user-1', name: 'No runner', enabled: true, isBuiltIn: false },
      { id: 'user-2', name: 'Polish', enabled: true, isBuiltIn: false, runner: 'default', prompt: 'Polish {{text}}' }
    ]

    expect(parseSelectionActions(items).map((item) => item.id)).toEqual(['copy', 'user-2'])
  })

  it('drops fields a built-in action does not own', () => {
    const [search] = parseSelectionActions([
      { id: 'search', name: 'Search', enabled: true, isBuiltIn: true, searchEngine: 'G|u', assistantId: 'a-1' }
    ])

    expect(search).toEqual({ id: 'search', name: 'Search', enabled: true, isBuiltIn: true, searchEngine: 'G|u' })
  })
})

const agent = (id: string, overrides: Partial<AgentEntity> = {}) =>
  ({ id, name: id, model: 'openai::gpt-5', modelName: 'GPT-5', configuration: {}, ...overrides }) as AgentEntity
const CHERRY_ASSISTANT = agent('cherry', { configuration: { builtin_role: 'assistant' } })
const ASK_AGENT: AskAgentSelectionAction = { id: 'ask-agent', name: 'Ask Agent', enabled: true, isBuiltIn: true }
const customAgentAction = (agentId?: string): CustomSelectionAction => ({
  id: 'user-1',
  name: 'Research',
  enabled: true,
  isBuiltIn: false,
  runner: 'agent',
  agentId
})

describe('getSelectionActionAgent', () => {
  it('ignores actions that do not run on an agent', () => {
    const custom: CustomSelectionAction = { ...customAgentAction('a-1'), runner: 'assistant' }

    expect(getSelectionActionAgent({ id: 'copy', name: 'Copy', enabled: true, isBuiltIn: true }, [])).toBeNull()
    expect(getSelectionActionAgent(custom, [agent('a-1')])).toBeNull()
  })

  it('runs an unbound Ask Agent on Cherry Assistant and flags it when it has no model', () => {
    expect(getSelectionActionAgent(ASK_AGENT, [agent('a-1'), CHERRY_ASSISTANT])).toEqual({
      agent: CHERRY_ASSISTANT,
      issue: null
    })

    const withoutModel = { ...CHERRY_ASSISTANT, model: null }
    expect(getSelectionActionAgent(ASK_AGENT, [withoutModel])?.issue).toBe('no_model')
  })

  it('keeps an unbound Ask Agent usable while Cherry Assistant is missing', () => {
    expect(getSelectionActionAgent(ASK_AGENT, [agent('a-1')])).toEqual({ agent: undefined, issue: null })
  })

  it('flags a bound agent that no longer exists', () => {
    expect(getSelectionActionAgent({ ...ASK_AGENT, agentId: 'gone' }, [CHERRY_ASSISTANT])?.issue).toBe(
      'agent_unavailable'
    )
    expect(getSelectionActionAgent(customAgentAction('gone'), [agent('a-1')])?.issue).toBe('agent_unavailable')
    expect(getSelectionActionAgent(customAgentAction(), [agent('a-1')])?.issue).toBe('agent_unavailable')
  })

  it('flags a bound agent without a model', () => {
    const result = getSelectionActionAgent(customAgentAction('a-1'), [agent('a-1', { model: null, modelName: null })])

    expect(result).toEqual({ agent: expect.objectContaining({ id: 'a-1' }), issue: 'no_model' })
  })

  it('flags an agent whose model was deleted', () => {
    const deletedModel = { modelName: null }

    expect(getSelectionActionAgent(customAgentAction('a-1'), [agent('a-1', deletedModel)])?.issue).toBe('no_model')
    expect(getSelectionActionAgent(ASK_AGENT, [{ ...CHERRY_ASSISTANT, ...deletedModel }])?.issue).toBe('no_model')
  })
})
