import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { modelSupportsCliTool } from '../modelSupport'

const modelWithEndpoint = (endpoint: EndpointType) => ({ endpointTypes: [endpoint] }) as unknown as Model

describe('modelSupportsCliTool', () => {
  it.each([ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES])(
    'allows MiniMax Code to use %s models',
    (endpoint) => {
      expect(modelSupportsCliTool(CodeCli.MCODE, modelWithEndpoint(endpoint))).toBe(true)
    }
  )

  it('does not offer Gemini-only models to MiniMax Code', () => {
    expect(modelSupportsCliTool(CodeCli.MCODE, modelWithEndpoint(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT))).toBe(false)
  })
})
