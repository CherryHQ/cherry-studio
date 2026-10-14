import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

import { modelSupportsCliTool } from '../modelSupport'

const model = (endpointTypes: string[]): Model => ({ endpointTypes }) as Model

describe('modelSupportsCliTool', () => {
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
