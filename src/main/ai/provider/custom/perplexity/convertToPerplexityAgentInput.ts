/**
 * Convert an AI SDK prompt into the Perplexity Agent API `input[]` (plus the
 * system text hoisted to `instructions`). The Agent API is OpenAI-Responses
 * shaped, so we use Responses-style input content parts.
 *
 * ponytail: file parts follow OpenAI-Responses conventions (`input_image` /
 * `input_file`); if Perplexity diverges, adjust the two mappers below. Tool
 * messages are out of scope (no function-calling this pass) and rejected.
 */
import { type LanguageModelV3CallOptions, type SharedV3Warning, UnsupportedFunctionalityError } from '@ai-sdk/provider'
import { convertUint8ArrayToBase64 } from '@ai-sdk/provider-utils'

type Prompt = LanguageModelV3CallOptions['prompt']

interface PerplexityAgentInputResult {
  input: Array<{ role: string; content: string | unknown[] }>
  instructions?: string
  warnings: SharedV3Warning[]
}

function fileToUrl(data: string | Uint8Array | URL, mediaType: string): string {
  if (data instanceof URL) return data.toString()
  if (typeof data === 'string') return data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`
  return `data:${mediaType};base64,${convertUint8ArrayToBase64(data)}`
}

export function convertToPerplexityAgentInput(prompt: Prompt): PerplexityAgentInputResult {
  const input: PerplexityAgentInputResult['input'] = []
  const warnings: SharedV3Warning[] = []
  const instructionParts: string[] = []

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system':
        instructionParts.push(content)
        break
      case 'user':
      case 'assistant': {
        const textType = role === 'assistant' ? 'output_text' : 'input_text'
        const parts: unknown[] = []
        for (const part of content) {
          switch (part.type) {
            case 'text':
              parts.push({ type: textType, text: part.text })
              break
            case 'file': {
              if (part.mediaType === 'application/pdf') {
                // Remote files go in `file_url`; `file_data` only accepts base64/data-URI.
                parts.push(
                  part.data instanceof URL
                    ? { type: 'input_file', file_url: part.data.toString() }
                    : {
                        type: 'input_file',
                        filename: part.filename ?? 'document.pdf',
                        file_data: fileToUrl(part.data, part.mediaType)
                      }
                )
              } else if (part.mediaType.startsWith('image/')) {
                parts.push({ type: 'input_image', image_url: fileToUrl(part.data, part.mediaType) })
              } else {
                warnings.push({ type: 'unsupported', feature: `file part (${part.mediaType})` })
              }
              break
            }
            // reasoning / tool-call / tool-result parts on assistant turns are not
            // replayed to the Agent API (search+citations+reasoning scope).
            default:
              break
          }
        }
        // Text-only turns collapse to a plain string, which the API also accepts.
        const textOnly = parts.length > 0 && parts.every((p) => (p as { type: string }).type === textType)
        input.push({
          role,
          content: textOnly ? parts.map((p) => (p as { text: string }).text).join('') : parts
        })
        break
      }
      case 'tool':
        throw new UnsupportedFunctionalityError({ functionality: 'Tool messages' })
      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return {
    input,
    instructions: instructionParts.length > 0 ? instructionParts.join('\n\n') : undefined,
    warnings
  }
}
