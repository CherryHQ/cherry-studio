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
import { ATTACHMENT_INPUT_SAFETY_RATIO, DEFAULT_MAX_TOKENS } from '@main/ai/constants'
import { resolveContextWindow } from '@main/ai/contextBuild/resolveContextWindow'
import { resolveModelTokenDialect } from '@main/ai/tokens/dialect'
import { countToolTokens, estimateModelMessagesSync } from '@main/ai/tokens/footprint'
import { getTextTokenizer } from '@main/ai/tokens/profiles'
import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'
import { serializeToolSchema } from '@main/ai/tools/adapters/aiSdk/meta/schemaStub'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ToolSet, UIMessage } from 'ai'

import type { MediaCapabilities } from './messageCapabilities'
import { toModelMessages } from './messageRules'

/** What one request may still spend on inlined attachment text. */
export interface AttachmentBudget {
  tokens: number
  tokenizer: TextTokenizer
}

export interface AttachmentBudgetInput {
  provider: Provider
  model: Model
  system: string | undefined
  tools: ToolSet | undefined
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

  const reservation = input.maxOutputTokens ?? input.model.maxOutputTokens ?? DEFAULT_MAX_TOKENS
  const usable = Math.floor((window - reservation) * ATTACHMENT_INPUT_SAFETY_RATIO)
  return { tokens: Math.max(0, usable - spent), tokenizer }
}

/**
 * Character caps for each pending inline, drawn from one shared token pool.
 * Order-independent: the routing pass runs messages in parallel, so a running
 * budget would make the result depend on completion order.
 */
export function allocateInlineCaps(bodies: readonly string[], budget: AttachmentBudget): number[] {
  const sizes = bodies.map((body) => budget.tokenizer.count(body))
  const allocated = allocateAttachmentBudget(sizes, budget.tokens)
  return bodies.map((body, index) => charCapFor(body, sizes[index], allocated[index]))
}

/**
 * Water-filling: smallest first, each takes an equal share of what is left or
 * its whole size, whichever is smaller, and returns the difference to the pool.
 * Small files arrive complete and the large ones split the rest. The sum never
 * exceeds `total` — that ceiling is the whole point, so there is no per-file
 * floor to stack on top of it.
 *
 * Exported for tests.
 */
export function allocateAttachmentBudget(sizes: readonly number[], total: number): number[] {
  const allocated = new Array<number>(sizes.length).fill(0)
  const smallestFirst = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size)

  let remaining = Math.max(0, total)
  let unserved = smallestFirst.length
  for (const { size, index } of smallestFirst) {
    const take = Math.min(Math.max(0, size), Math.floor(remaining / unserved))
    allocated[index] = take
    remaining -= take
    unserved--
  }
  return allocated
}

/** Token cap back to a cut point, using this text's own measured ratio. */
function charCapFor(body: string, tokens: number, tokenCap: number): number {
  if (tokenCap >= tokens || tokens <= 0) return body.length
  return Math.floor(tokenCap * (body.length / tokens))
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
