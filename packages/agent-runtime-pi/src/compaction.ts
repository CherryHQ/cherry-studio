import type { Api, Message, Model } from '@earendil-works/pi-ai'
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'
import { convertToLlm, type ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { CompactionReason } from './sessionEvents'

export interface CompactionSummaryRequest {
  /** The compacting session's Pi session id; for a subagent, the id `SubagentPort.configure` received. */
  sessionId: string
  reason: CompactionReason
  sessionId: string
  model: Model<Api>
  /** Native messages after Pi replay rules, before provider conversion. */
  messages: Message[]
  /** Summary of the previous compaction, to carry forward. */
  previousSummary?: string
  /** Focus given to a manual compaction (`session.compact(instructions)`). */
  instructions?: string
  signal: AbortSignal
}

/**
 * Host summarizer: its own prompt and model. The text it returns is stored as the compaction summary;
 * Pi frames it when it builds the next context. A rejection cancels the compaction.
 */
export type CompactionSummarizer = (request: CompactionSummaryRequest) => Promise<string>

/** Pi's native compaction: on crossing `contextWindow - reserveTokens`, and one compact-and-retry on overflow. */
export interface AgentRuntimeCompaction {
  /** Off: no threshold or overflow compaction; `session.compact()` still works. Default on. */
  enabled?: boolean
  reserveTokens: number
  /** Recent context kept verbatim. */
  keepRecentTokens: number
  /** Without it, Pi's default summarizer runs on the session model through its native model runtime. */
  summarize?: CompactionSummarizer
}

/** Routes Pi's `session_before_compact` to the host summarizer; `onFailure` gets the reason a summary failed. */
export function compactionSummaryExtension(
  summarize: CompactionSummarizer,
  onFailure: (message: string) => void
): ExtensionFactory {
  return (pi) => {
    pi.on('session_before_compact', async (event, ctx) => {
      const { preparation, signal } = event
      try {
        const summary = await summarize({
          sessionId: ctx.sessionManager.getSessionId(),
          reason: event.reason,
          sessionId: ctx.sessionManager.getSessionId(),
          model: ctx.model!,
          messages: transformMessages(
            convertToLlm([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]),
            ctx.model!
          ),
          ...(preparation.previousSummary === undefined ? {} : { previousSummary: preparation.previousSummary }),
          ...(event.customInstructions === undefined ? {} : { instructions: event.customInstructions }),
          signal
        })
        if (!summary.trim()) throw new Error('The summarizer returned an empty summary')
        return {
          compaction: {
            summary,
            firstKeptEntryId: preparation.firstKeptEntryId,
            tokensBefore: preparation.tokensBefore
          }
        }
      } catch (error) {
        // A throwing handler would make Pi fall back to its own summarizer on the session model.
        if (!signal.aborted) onFailure(error instanceof Error ? error.message : String(error))
        return { cancel: true }
      }
    })
  }
}
