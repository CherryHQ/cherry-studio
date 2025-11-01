import { loggerService } from '@logger'
import type { ActionTool } from '@renderer/components/ActionTools'
import { TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { usePendingMap } from '@renderer/hooks/usePendingMap'
import { useQuickCompletion } from '@renderer/hooks/useQuickCompletion'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { getErrorMessage, parseJSON } from '@renderer/utils'
import { abortCompletion, readyToAbort } from '@renderer/utils/abortController'
import { WrenchIcon } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

const logger = loggerService.withContext('useMermaidFixTool')

interface UseMermaidFixTool {
  enabled?: boolean
  context: {
    /** Code block id */
    blockId: string
    /** Error */
    error: unknown
    /** Mermaid code */
    content: string
  }
  onSave: (newContent: string) => Promise<void>
  setTools: React.Dispatch<React.SetStateAction<ActionTool[]>>
}

const ResultSchema = z.union([
  z.object({
    fixed: z.literal(true),
    result: z.string()
  }),
  z.object({
    fixed: z.literal(false),
    reason: z.string()
  })
])

/**
 * Input shape for the Mermaid fix prompt.
 */
type Input = {
  /** Mermaid diagram code to be fixed */
  mermaid: string
  /** Error message returned by the renderer */
  error: string
  /** User’s language code (e.g. zh-cn, en-us) */
  lang: string
}

const SYSTEM_PROMPT = `
You are an AI assistant that fixes Mermaid code. The input is a JSON string with the following structure: {"mermaid": "the Mermaid code", "error": "the error message from rendering", "lang": "the user's language code"}.

Your task is to analyze the error and the Mermaid code. If the error is due to a mistake in the Mermaid code, fix it and output a JSON string with {"fixed": true, "result": "the fixed Mermaid code"}. If the error is not caused by the code (e.g., environment issues, unsupported features, or other non-code errors), output {"fixed": false, "reason": "a brief explanation in the language specified by the 'lang' field"}.

Your output must be a pure JSON string with no additional text, comments, or formatting (e.g., no markdown code blocks like \`\`\`json). The entire response body must be the JSON object itself.

# Steps

1.  **Analyze**: Carefully examine the input \`mermaid\` code and the \`error\` message.
2.  **Diagnose**: Determine the root cause of the error. Is it a fixable syntax or logical error within the code, or an external issue (e.g., environment problem, unsupported feature)?
3.  **Generate Output**:
    *   If the code can be fixed, generate a JSON object containing the fixed code.
    *   If the code cannot be fixed, generate a JSON object explaining the reason.

# Output Format

Your output must be a well-formed, pure JSON string.

**Crucially**: Do not include any explanatory text, comments, or markdown code blocks (e.g., \`\`\`json) outside of the JSON output. Your entire response content must be the raw JSON object itself.

*   **If fixed**: Output a JSON object with the following structure:
    \`{"fixed": true, "result": "the fixed Mermaid code"}\`
    The \`result\` field must contain the complete, runnable Mermaid code string.

*   **If not fixed**: Output a JSON object with the following structure:
    \`{"fixed": false, "reason": "a brief explanation"}\`
    The explanation in the \`reason\` field must be in the language specified by the input \`lang\` field.

# Examples

**Example 1: Fixable error**

*   **Input**:
    \`\`\`json
    {
      "mermaid": "graph TD\nA[Start] --> B{Error?",
      "error": "Syntax error: a node is not properly closed",
      "lang": "en-us"
    }
    \`\`\`

*   **Output**:
    \`\`\`json
    {"fixed": true, "result": "graph TD\n    A[Start] --> B{Error?}"}
    \`\`\`

**Example 2: Unfixable error**

*   **Input**:
    \`\`\`json
    {
      "mermaid": "gitGraph\n   commit\n   branch new-feature\n   checkout new-feature",
      "error": "Feature not supported in this version",
      "lang": "en-us"
    }
    \`\`\`

*   **Output**:
    \`\`\`json
    {"fixed": false, "reason": "The error is due to an unsupported feature in the current environment."}
    \`\`\`

# Notes

*   When returning \`{"fixed": false, ...}\`, ensure the \`reason\` field's text content matches the language specified by the input \`lang\` code.
*   Your primary objective is to provide a clean, machine-readable JSON output.

`

export const useMermaidFixTool = ({ enabled, context, onSave, setTools }: UseMermaidFixTool) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolManager(setTools)
  const { language } = useSettings()
  const completion = useQuickCompletion(SYSTEM_PROMPT)

  const { error, content, blockId } = context
  const abortKeyRef = useRef<string | null>(null)

  const { setPending } = usePendingMap()
  logger.debug('input', {
    mermaid: content,
    error: getErrorMessage(error),
    lang: language
  })
  const prompt = JSON.stringify({
    mermaid: content,
    error: getErrorMessage(error),
    lang: language
  } satisfies Input)

  const fixCode = useCallback(async () => {
    setPending(blockId, true)
    const abortKey = crypto.randomUUID()
    abortKeyRef.current = abortKey
    const signal = readyToAbort(abortKey)
    let result = ''

    const onChunk = (chunk: Chunk) => {
      if (chunk.type === ChunkType.TEXT_DELTA) {
        result = chunk.text
      }
    }

    try {
      await completion({
        prompt,
        onChunk,
        params: {
          options: {
            signal
          }
        }
      })
    } catch (e) {
      window.toast.error({ title: t('code_block.mermaid_fix.failed'), description: getErrorMessage(e) })
      return
    }

    result = result.trim()
    logger.debug('output', { result })

    const parsedJson = parseJSON(result)
    if (parsedJson === null) {
      window.toast.error({
        title: t('code_block.mermaid_fix.failed'),
        description: t('code_block.mermaid_fix.invalid_result')
      })
    } else {
      logger.debug('parseJSON success', { parsedJson })
      const parsedResult = ResultSchema.safeParse(parsedJson)
      logger.debug('validation', { parsedResult })

      if (parsedResult.success) {
        const validResult = parsedResult.data
        if (validResult.fixed) {
          await onSave(validResult.result)
        } else {
          window.toast.warning({ title: t('code_block.mermaid_fix.failed'), description: validResult.reason })
        }
      } else {
        window.toast.error({
          title: t('code_block.mermaid_fix.failed'),
          description: t('code_block.mermaid_fix.invalid_result')
        })
      }
    }

    setPending(blockId, false)
  }, [setPending, blockId, completion, prompt, t, onSave])

  // when unmounted
  useEffect(() => {
    return () => {
      const abortKey = abortKeyRef.current
      if (abortKey) {
        abortCompletion(abortKey)
      }
    }
  }, [])

  useEffect(() => {
    if (enabled) {
      registerTool({
        ...TOOL_SPECS.mermaid_fix,
        icon: <WrenchIcon size={'1rem'} className="tool-icon" />,
        tooltip: t('code_block.mermaid_fix.label'),
        visible: () => error !== undefined && error !== null,
        onClick: () => fixCode()
      })
    }

    return () => removeTool(TOOL_SPECS.mermaid_fix.id)
  }, [enabled, error, fixCode, registerTool, removeTool, t])
}
