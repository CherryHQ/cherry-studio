import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

import { modelSupportsCliTool } from '../modelSupport'

const model = (endpointTypes: Model['endpointTypes']): Model => ({
  id: 'test::model',
  providerId: 'test',
  name: 'Model',
  capabilities: [],
  endpointTypes,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

describe('modelSupportsCliTool', () => {
  it('excludes Interactions from OpenClaw even when a later endpoint is compatible', () => {
    expect(modelSupportsCliTool(CodeCli.OPENCLAW, model([ENDPOINT_TYPE.GOOGLE_INTERACTIONS]))).toBe(false)
    expect(
      modelSupportsCliTool(
        CodeCli.OPENCLAW,
        model([ENDPOINT_TYPE.GOOGLE_INTERACTIONS, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
      )
    ).toBe(false)
    expect(modelSupportsCliTool(CodeCli.OPENCLAW, model([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]))).toBe(true)
  })

  it('uses the provider endpoint when model metadata is absent', () => {
    expect(modelSupportsCliTool(CodeCli.OPENCLAW, model([]), ENDPOINT_TYPE.GOOGLE_INTERACTIONS)).toBe(false)
    expect(modelSupportsCliTool(CodeCli.OPENCLAW, model([]), ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(true)
  })

  it('gives Antigravity the same Gemini endpoint contract as Gemini CLI', () => {
    const models = [
      model([ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]),
      model([ENDPOINT_TYPE.ANTHROPIC_MESSAGES]),
      model([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
    ]

    expect(models.map((item) => modelSupportsCliTool(CodeCli.ANTIGRAVITY_CLI, item))).toEqual(
      models.map((item) => modelSupportsCliTool(CodeCli.GEMINI_CLI, item))
    )
    expect(modelSupportsCliTool(CodeCli.ANTIGRAVITY_CLI, models[0])).toBe(true)
    expect(modelSupportsCliTool(CodeCli.ANTIGRAVITY_CLI, models[1])).toBe(false)
  })
})
