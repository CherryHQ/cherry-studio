import { describe, expect, it } from 'vitest'

import { modelSupportsCliTool } from '@renderer/services/codeCliConfig'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

const model = (endpointTypes: string[]): Model => ({ endpointTypes }) as Model

describe('modelSupportsCliTool', () => {
  it('requires a Gemini endpoint for Antigravity', () => {
    const models = [
      model([ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]),
      model([ENDPOINT_TYPE.ANTHROPIC_MESSAGES]),
      model([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
    ]

    expect(models.map((item) => modelSupportsCliTool(CodeCli.ANTIGRAVITY_CLI, item))).toEqual([true, false, false])
  })
})
