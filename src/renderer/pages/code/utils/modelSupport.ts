import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

const OPENAI_LIKE_ENDPOINTS = [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES]

function hasModelEndpoint(model: Model, endpoint: string): boolean {
  if (!model.endpointTypes?.length) return true
  return model.endpointTypes.includes(endpoint as any)
}

function hasAnyModelEndpoint(model: Model, endpoints: string[]): boolean {
  if (!model.endpointTypes?.length) return true
  return model.endpointTypes.some((endpoint) => endpoints.includes(endpoint))
}

export function modelSupportsCliTool(cliTool: CodeCli, model: Model): boolean {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      return hasModelEndpoint(model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    case CodeCli.OPENAI_CODEX:
      return hasModelEndpoint(model, ENDPOINT_TYPE.OPENAI_RESPONSES)
    case CodeCli.OPEN_CODE:
      return hasAnyModelEndpoint(model, [
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        ...OPENAI_LIKE_ENDPOINTS
      ])
    case CodeCli.OPENCLAW:
      return hasAnyModelEndpoint(model, [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ...OPENAI_LIKE_ENDPOINTS])
    case CodeCli.GEMINI_CLI:
      return hasModelEndpoint(model, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    case CodeCli.QWEN_CODE:
    case CodeCli.KIMI_CODE:
      return hasAnyModelEndpoint(model, OPENAI_LIKE_ENDPOINTS)
    case CodeCli.PI:
      return hasAnyModelEndpoint(model, [
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        ...OPENAI_LIKE_ENDPOINTS
      ])
    case CodeCli.QODER_CLI:
    case CodeCli.GITHUB_COPILOT_CLI:
      return false
    default:
      return false
  }
}
