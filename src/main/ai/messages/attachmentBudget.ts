import type { ToolSet, UIMessage } from 'ai'

/**
 * Request-level token budget for attachment text inlined into the prompt.
 *
 * The inline cap used to be a flat per-file character count, so N attachments
 * cost N × cap and nothing bounded the total — the request could overflow the
 * window it was nominally sized against. This prices what the request already
 * spends (system prompt, tool definitions, history, native media) against the
 * model's window and hands the remainder to the attachments as one shared pool.
 *
 * Every number here is an estimate with a safety ratio on top, not a ledger:
 * erring small costs a `read_file` page, erring large fails the request.
 */
import { ATTACHMENT_INPUT_SAFETY_RATIO } from '@main/ai/constants'
import { resolveContextWindow } from '@main/ai/contextBuild/resolveContextWindow'
import { resolveInputRoom } from '@main/ai/contextBuild/resolveInputRoom'
import { resolveModelTokenDialect } from '@main/ai/tokens/dialect'
import { countToolTokens, estimateModelMessagesSync } from '@main/ai/tokens/footprint'
import { getTextTokenizer } from '@main/ai/tokens/profiles'
import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'
import { serializeToolSchema } from '@main/ai/tools/adapters/aiSdk/meta/schemaStub'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { MediaCapabilities } from './messageCapabilities'
import { toModelMessages } from './messageRules'

/** What one request may still spend on inlined attachment text. */
export interface AttachmentBudget {
  tokens: number
}

export interface AttachmentBudgetInput {
  provider: Provider
  model: Model
  system: string | undefined
  tools: ToolSet | undefined
  /** What this request declares as `max_tokens`; undefined = it declares none. */
  maxOutputTokens: number | undefined
  /** History as it stands BEFORE inlining, so attachment text is not counted twice. */
  messages: UIMessage[]
  mediaCapabilities: MediaCapabilities
}

/**
 * `null` when no budget can be computed — the model declares no context window,
 * or the history could not be priced. Callers fall back to their flat cap.
 */
export async function resolveAttachmentBudget(input: AttachmentBudgetInput): Promise<AttachmentBudget | null> {
  const window = resolveContextWindow(input.model.contextWindow)
  if (window === null) return null

  const dialect = resolveModelTokenDialect(input.provider, input.model)
  const tokenizer = await getTextTokenizer(dialect)

  let spent: number
  try {
    const priced = await toModelMessages(input.messages, input.mediaCapabilities, input.tools)
    spent = estimateModelMessagesSync(priced, { dialect, tokenizer })
  } catch {
    return null
  }
  spent += tokenizer.count(input.system ?? '')
  spent += await countToolSetTokens(input.tools, tokenizer)

  const usable = Math.floor(resolveInputRoom(window, input.maxOutputTokens) * ATTACHMENT_INPUT_SAFETY_RATIO)
  return { tokens: Math.max(0, usable - spent) }
}

/**
 * The definitions actually sent this request. `serializeToolSchema` normalizes
 * Zod / `jsonSchema()` wrappers to the schema the model receives.
 */
async function countToolSetTokens(tools: ToolSet | undefined, tokenizer: TextTokenizer): Promise<number> {
  if (!tools) return 0
  const perTool = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => {
      const schema = await serializeToolSchema((tool as { inputSchema?: unknown }).inputSchema)
      return countToolTokens({ name, description: (tool as { description?: string }).description, schema }, tokenizer)
    })
  )
  return perTool.reduce((sum, tokens) => sum + tokens, 0)
}
