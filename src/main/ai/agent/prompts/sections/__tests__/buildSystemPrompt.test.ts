import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (input: string) => input)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { buildSystemPrompt } from '../buildSystemPrompt'

const model = { id: 'x::y' as UniqueModelId, providerId: 'x', name: 'Y' } as Model

beforeEach(() => {
  // Default — output_style is 'default' so the section drops out.
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.system_prompt.output_style', 'default')
})

afterEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  vi.clearAllMocks()
})

describe('buildSystemPrompt', () => {
  /**
   * The contributor array in `buildSystemPrompt.ts` pins the order. If
   * anyone reshuffles it without updating this assertion, the change is
   * intentional — but at least it shows up in the diff.
   */
  it('emits sections in the cacheable-then-noncacheable order', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.system_prompt.output_style', 'concise')
    const sections = await buildSystemPrompt({
      assistant: { prompt: 'hello' } as never,
      model,
      tools: { tool_search: {} } as unknown as ToolSet
    })
    expect(sections.map((s) => s.id)).toEqual([
      'identity',
      'system_rules',
      'agent_discipline',
      'actions',
      'tone_and_output',
      'assistant_prompt',
      'tool_intros',
      'env',
      'output_style'
    ])
  })

  /**
   * Cacheable partitioning is the whole point of the registry — if a
   * future contributor flips the wrong flag, prompt-cache hit rate
   * silently drops. Pin both groups.
   */
  it('marks frozen / toolset-derived sections cacheable and runtime-volatile sections non-cacheable', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.system_prompt.output_style', 'pragmatic')
    const sections = await buildSystemPrompt({
      assistant: { prompt: 'hello' } as never,
      model,
      tools: { tool_search: {} } as unknown as ToolSet
    })
    const flags = Object.fromEntries(sections.map((s) => [s.id, s.cacheable]))
    expect(flags).toMatchObject({
      identity: true,
      system_rules: true,
      agent_discipline: true,
      actions: true,
      tone_and_output: true,
      assistant_prompt: true,
      tool_intros: true,
      env: false,
      output_style: false
    })
  })

  /**
   * codeWorkflowSection is gated on `fs__*` / `shell__*` / Claude-Code-style
   * tool names. A non-code assistant (writing / chat / translation) has
   * no code workflow section in its prompt — keeps the prompt neutral
   * for those flows.
   */
  it('drops code_workflow when the toolset has no fs__/shell__ tools', async () => {
    const sections = await buildSystemPrompt({
      assistant: { prompt: 'hello' } as never,
      model,
      tools: { web_search: {}, knowledge_search: {} } as unknown as ToolSet
    })
    expect(sections.find((s) => s.id === 'code_workflow')).toBeUndefined()
  })

  it('emits code_workflow when fs__ or shell__ tools are present', async () => {
    const sections = await buildSystemPrompt({
      assistant: { prompt: 'hello' } as never,
      model,
      tools: { fs__read: {}, shell__exec: {} } as unknown as ToolSet
    })
    expect(sections.find((s) => s.id === 'code_workflow')).toBeDefined()
  })

  /**
   * Empty / undefined contributions get filtered. Default output style
   * emits no prose, so the section is dropped entirely instead of
   * surviving as an empty block.
   */
  it('drops sections that contribute no text (default output_style → no section emitted)', async () => {
    const sections = await buildSystemPrompt({
      assistant: { prompt: 'hello' } as never,
      model
    })
    expect(sections.find((s) => s.id === 'output_style')).toBeUndefined()
  })

  it('drops assistant_prompt when assistant has no prompt body', async () => {
    const sections = await buildSystemPrompt({ model })
    expect(sections.find((s) => s.id === 'assistant_prompt')).toBeUndefined()
  })

  it('drops tool_intros when tool_search is not in the active tool set', async () => {
    const sections = await buildSystemPrompt({
      assistant: { prompt: 'hello' } as never,
      model,
      tools: { other: {} } as unknown as ToolSet
    })
    expect(sections.find((s) => s.id === 'tool_intros')).toBeUndefined()
  })
})
