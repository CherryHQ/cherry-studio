import { describe, expect, it } from 'vitest'

import { buildToolResponseFromPart } from '@renderer/components/chat/messages/tools/toolResponse'
import type { CherryMessagePart } from '@shared/data/types/message'

import { agentInlineResultPresentationRegistry } from '../agentInlineResultPresentationRegistry'
import { getSkillCaptureResult } from '../skillCaptureResult'

const inlineResultParts = [
  {
    type: 'dynamic-tool',
    toolCallId: 'create-agent',
    toolName: 'mcp__assistant__create_agent',
    state: 'output-available',
    input: {},
    output: {
      ok: true,
      agentId: 'agent-created',
      name: 'Reviewer',
      model: 'anthropic::claude-sonnet'
    }
  },
  {
    type: 'dynamic-tool',
    toolCallId: 'prepare-report',
    toolName: 'mcp__assistant__prepare_diagnostic_report',
    state: 'output-available',
    input: {},
    output: { ok: true, description: 'Editable diagnostic report draft' }
  },
  {
    type: 'dynamic-tool',
    toolCallId: 'create-task',
    toolName: 'mcp__cherry-tools__cron',
    state: 'output-available',
    input: { action: 'add', name: 'Gold price', message: 'Check the gold price', cron: '0 21 * * *' },
    output: {
      content: `Job created:\n${JSON.stringify({ id: 'task-1', name: 'Gold price' })}`,
      metadata: { type: 'mcp', name: 'cron', serverName: 'cherry-tools', serverId: 'cherry-tools' }
    }
  }
] as CherryMessagePart[]

describe('agentInlineResultPresentationRegistry', () => {
  it.each(['claude-code', 'pi'])('preserves the bound suggestion in %s tool output', (transport) => {
    const ref = { sessionId: '33333333-3333-4333-8333-333333333333', messageId: '44444444-4444-4444-8444-444444444444' }
    const part: CherryMessagePart = {
      type: 'dynamic-tool',
      toolCallId: 'save-skill',
      toolName: 'mcp__skills__suggest_skill',
      state: 'output-available',
      input: {},
      callProviderMetadata: { cherry: { transport } },
      output: { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...ref }) }] }
    }
    const response = buildToolResponseFromPart(part)!
    expect(agentInlineResultPresentationRegistry.isResultPart(part)).toBe(true)
    expect(getSkillCaptureResult(response)).toEqual(ref)
    expect(agentInlineResultPresentationRegistry.renderResult(response)).toBeDefined()
  })

  it('does not turn a suppressed suggestion into an actionable card', () => {
    const response = buildToolResponseFromPart({
      type: 'dynamic-tool',
      toolCallId: 'save-skill',
      toolName: 'mcp__skills__suggest_skill',
      state: 'output-available',
      input: {},
      output: { content: [{ type: 'text', text: '{"ok":false}' }] }
    })!
    expect(getSkillCaptureResult(response)).toBeUndefined()
  })
  it.each(inlineResultParts)('classifies and renders an agent-owned inline result', (part) => {
    const toolResponse = buildToolResponseFromPart(part)

    expect(toolResponse).not.toBeNull()
    expect(agentInlineResultPresentationRegistry.isResultPart(part)).toBe(true)
    expect(agentInlineResultPresentationRegistry.renderResult(toolResponse!)).toBeDefined()
  })

  it('leaves ordinary tool results to the generic message presentation', () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'read',
      toolName: 'Read',
      state: 'output-available',
      input: {},
      output: 'contents'
    } as CherryMessagePart
    const toolResponse = buildToolResponseFromPart(part)

    expect(toolResponse).not.toBeNull()
    expect(agentInlineResultPresentationRegistry.isResultPart(part)).toBe(false)
    expect(agentInlineResultPresentationRegistry.renderResult(toolResponse!)).toBeUndefined()
  })
})
