import { describe, expect, it, vi } from 'vitest'

const { generateText, getAgent, loggerWarn } = vi.hoisted(() => ({
  generateText: vi.fn(),
  getAgent: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'AiService') return { generateText }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent }
}))

import type { AskExpertInput } from '@shared/ai/builtinTools'

import { askExpert, buildExpertSystemPrompt } from '../askExpert'

const INPUT: AskExpertInput = {
  objective: 'Find the root cause of the failing test.',
  context: 'The test throws TypeError: x is undefined at line 12.',
  output_format: 'VERDICT / ADVICE / RISKS',
  trigger: 'Two failed attempts with no new evidence.',
  question_type: 'code_debug'
}

const AGENT = { id: 'agent-1', expertModel: 'openai::gpt-expert' }

describe('askExpert', () => {
  it('refuses without a configured expert model and never reaches the provider', async () => {
    getAgent.mockReturnValueOnce({ id: 'agent-1' })

    const result = await askExpert(INPUT, { agentId: 'agent-1' })

    expect(result).toMatchObject({ ok: false, code: 'not_configured' })
    expect(String(result.ok === false && result.message)).toContain('Expert model')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('calls the configured expert model as a tool-less single turn', async () => {
    getAgent.mockReturnValueOnce(AGENT)
    generateText.mockResolvedValueOnce({
      text: 'VERDICT: proceed\nADVICE: guard the value before use.',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: 'stop'
    })

    const result = await askExpert(INPUT, { agentId: 'agent-1' })

    expect(result).toMatchObject({
      ok: true,
      model: 'openai::gpt-expert',
      inputTokens: 10,
      outputTokens: 5
    })
    const request = generateText.mock.calls[0][0]
    expect(request).toMatchObject({ uniqueModelId: 'openai::gpt-expert', disableTools: true })
    expect(request.system).toContain('You are the expert')
    expect(request.system).toContain('root cause')
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining(INPUT.context)
      }
    ])
  })

  it('turns a provider failure into an unavailable result the model can read', async () => {
    getAgent.mockReturnValueOnce(AGENT)
    generateText.mockRejectedValueOnce(new Error('429 rate limited'))

    const result = await askExpert(INPUT, { agentId: 'agent-1' })

    expect(result).toMatchObject({ ok: false, code: 'unavailable' })
    expect(String(result.ok === false && result.message)).toContain('429 rate limited')
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('rejects an empty answer instead of returning a blank consultation', async () => {
    getAgent.mockReturnValueOnce(AGENT)
    generateText.mockResolvedValueOnce({ text: '   ', finishReason: 'stop' })

    const result = await askExpert(INPUT, { agentId: 'agent-1' })

    expect(result).toMatchObject({ ok: false, code: 'unavailable' })
  })

  it('reports an aborted call as aborted rather than a provider failure', async () => {
    getAgent.mockReturnValueOnce(AGENT)
    const controller = new AbortController()
    controller.abort()
    generateText.mockRejectedValueOnce(new Error('aborted'))

    const result = await askExpert(INPUT, { agentId: 'agent-1', signal: controller.signal })

    expect(result).toMatchObject({ ok: false, code: 'aborted' })
  })
})

describe('buildExpertSystemPrompt', () => {
  it('selects the question-type guidance', () => {
    expect(buildExpertSystemPrompt('code_debug')).toContain('root cause')
    expect(buildExpertSystemPrompt('math_reasoning')).toContain('substituted back')
    expect(buildExpertSystemPrompt('open_research')).toContain('evidence strength')
  })
})
