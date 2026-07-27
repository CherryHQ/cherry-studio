import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { modelSupportsCliTool } from '../modelSupport'

const model = (endpointTypes?: Model['endpointTypes']): Model => ({ endpointTypes }) as Model

describe('modelSupportsCliTool', () => {
  it('requires an explicit anthropic-messages declaration for Claude Code', () => {
    expect(modelSupportsCliTool(CodeCli.CLAUDE_CODE, model())).toBe(false)
    expect(modelSupportsCliTool(CodeCli.CLAUDE_CODE, model([]))).toBe(false)
    expect(modelSupportsCliTool(CodeCli.CLAUDE_CODE, model([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]))).toBe(false)
    expect(modelSupportsCliTool(CodeCli.CLAUDE_CODE, model([ENDPOINT_TYPE.ANTHROPIC_MESSAGES]))).toBe(true)
  })

  it('keeps the existing legacy fallback for other CLI tools', () => {
    expect(modelSupportsCliTool(CodeCli.OPEN_CODE, model())).toBe(true)
    expect(modelSupportsCliTool(CodeCli.KIMI_CODE, model())).toBe(true)
  })
})
