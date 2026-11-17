import type { Message } from '@earendil-works/pi-ai'

import type { CompactionSummarizer } from '@cherrystudio/agent-runtime-pi'

import type { createPiGatewayModelBinding } from './gatewayModelBinding'
import { resolvePiSummaryInputBudget } from './piCompactionSettings'
import { loadPiAiOverflow } from './piSdk'

type Binding = Awaited<ReturnType<typeof createPiGatewayModelBinding>>
type UsageCapture = () => { headers: Record<string, string>; release(): void }

const SUMMARY_SYSTEM_PROMPT =
  "Summarize this coding-agent conversation so the work can continue from the summary alone. Keep the user's original task, latest requests, decisions, file paths and unfinished work. If the transcript says earlier messages were omitted, state that the summary does not cover them."
const CHARS_PER_TOKEN = 4

type Part = { type: string; text?: string; name?: string; arguments?: unknown }

function serialize(message: Message): string {
  const body =
    typeof message.content === 'string'
      ? message.content
      : (message.content as readonly Part[])
          .map((part) =>
            part.type === 'text'
              ? (part.text ?? '')
              : part.type === 'toolCall'
                ? `tool call ${part.name}: ${JSON.stringify(part.arguments)}`
                : part.type === 'image'
                  ? '[image]'
                  : ''
          )
          .filter(Boolean)
          .join('\n')
  return `[${message.role}]\n${body}`
}

/** Keeps the first message (the initial task) and the newest messages that fit; the rest are counted as omitted. */
function fitTranscript(segments: readonly string[], budgetTokens: number): { text: string; omitted: number } {
  const budget = budgetTokens * CHARS_PER_TOKEN
  const [first, ...rest] = segments
  const head = first === undefined ? [] : [first.slice(0, budget)]
  let remaining = budget - (head[0]?.length ?? 0)
  const tail: string[] = []
  for (let i = rest.length - 1; i >= 0 && rest[i].length <= remaining; i--) {
    remaining -= rest[i].length
    tail.unshift(rest[i])
  }
  return { text: [...head, ...tail].join('\n\n'), omitted: rest.length - tail.length }
}

async function complete(binding: Binding, usage: UsageCapture, prompt: string, signal: AbortSignal) {
  const captured = usage()
  try {
    return await binding.modelRuntime.completeSimple(
      binding.model,
      {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }]
      },
      { signal, maxTokens: binding.model.maxTokens, headers: captured.headers }
    )
  } finally {
    captured.release()
  }
}

/** Host summarizer for Pi compaction: bounds its own input and retries once on a real context overflow. */
export function createPiCompactionSummarizer(options: { binding: Binding; usage: UsageCapture }): CompactionSummarizer {
  const { binding } = options
  const { contextWindow, maxTokens } = binding.model
  return async (request) => {
    const { isContextOverflow } = await loadPiAiOverflow()
    let budget = resolvePiSummaryInputBudget(contextWindow, maxTokens)
    for (let attempt = 0; ; attempt++) {
      const { text, omitted } = fitTranscript(request.messages.map(serialize), budget)
      const prompt = [
        omitted > 0 ? `${omitted} earlier messages were omitted to fit the summarizer window.` : '',
        request.previousSummary ? `<previous-summary>\n${request.previousSummary}\n</previous-summary>` : '',
        request.instructions ? `Focus: ${request.instructions}` : '',
        `<conversation>\n${text}\n</conversation>`
      ]
        .filter(Boolean)
        .join('\n\n')
      const result = await complete(binding, options.usage, prompt, request.signal)
      if (result.stopReason === 'stop') {
        const summary = result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
        return { summary, usage: result.usage }
      }
      if (attempt === 0 && isContextOverflow(result, contextWindow)) {
        budget = Math.floor(budget / 2)
        continue
      }
      throw new Error(result.errorMessage ?? `Summary request ended: ${result.stopReason}`)
    }
  }
}
