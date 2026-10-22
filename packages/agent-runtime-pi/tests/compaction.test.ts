import type { AssistantMessage } from '@earendil-works/pi-ai'
import { normalizeContext, Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { CompactionSummarizer, CompactionSummaryRequest } from '../src'
import type { ModelCall } from './sessionSupport'
import { respondingModel } from './sessionSupport'
import {
  assistantReply,
  createTestBinding,
  createTestSession,
  hostStore,
  lastAssistant,
  MODEL,
  plain,
  scriptedModel,
  tempDir
} from './sessionSupport'

const PAGE_CHARS = 9_000 // ~2.6k tokens per tool result

const fetchPage = defineTool({
  name: 'fetch_page',
  label: 'Fetch page',
  description: 'Fetch one page of a long document',
  parameters: Type.Object({ page: Type.Number() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: `PAGE-${params.page} ` + 'x'.repeat(PAGE_CHARS) }], details: undefined }
  }
})

/** The agent reads pages 1-3 with `fetch_page`, then answers. Requests without tools are Pi summaries. */
function pageReader(timeline: string[]) {
  const agentCalls: ModelCall[] = []
  const { model } = respondingModel((options) => {
    let chunks: AssistantMessage
    if ((options.tools ?? []).length === 0) {
      timeline.push('model:summarize')
      chunks = assistantReply(
        [{ type: 'text', text: '## Progress\nRead pages 1-2: SUMMARY-MARKER.' }],
        'stop',
        Math.ceil(JSON.stringify(options.messages).length / 3.5),
        20
      )
    } else {
      agentCalls.push(options)
      const step = agentCalls.length
      timeline.push(`model:agent#${step}`)
      chunks =
        step <= 3
          ? assistantReply(
              [{ type: 'toolCall', id: `call_${step}`, name: 'fetch_page', arguments: JSON.parse(`{"page":${step}}`) }],
              'toolUse',
              Math.ceil(JSON.stringify(options.messages).length / 3.5),
              20
            )
          : assistantReply(
              [{ type: 'text', text: 'Done reading.' }],
              'stop',
              Math.ceil(JSON.stringify(options.messages).length / 3.5),
              20
            )
    }
    return chunks
  })
  return { model, agentCalls }
}

describe('Pi compaction with native providers', () => {
  it('summarizes through the native provider and sends the summary in place of the compacted history', async () => {
    const { model, calls } = scriptedModel([
      assistantReply([{ type: 'text', text: 'Answer one.' }]),
      assistantReply([{ type: 'text', text: 'Answer two.' }]),
      assistantReply([{ type: 'text', text: '## Goal\nUser is Li from Paris.' }]),
      assistantReply([{ type: 'text', text: 'Answer three.' }])
    ])
    const { session } = await createTestSession({
      stream: model,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 }
    })
    await session.prompt('Question one, my name is Li')
    await session.prompt('Question two, I live in Paris')
    const result = await session.compact('keep the user facts')
    await session.prompt('Question three')

    expect(result.summary).toMatch(/Li from Paris/)
    const lastPrompt = JSON.stringify(calls.at(-1)!.messages)
    expect(lastPrompt).toMatch(/Li from Paris/)
    expect(lastPrompt).not.toMatch(/Question one/)
  })

  it('compacts inside the tool loop before the next model request', async () => {
    const timeline: string[] = []
    const { model, agentCalls } = pageReader(timeline)
    const host = hostStore()
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: 9_000 },
      tools: [fetchPage],
      // threshold = contextWindow - reserveTokens = 7k tokens; three pages (~8k) cross it.
      compaction: { reserveTokens: 2_000, keepRecentTokens: 3_000 },
      onEvent: host.onEvent
    })
    session.subscribe((event) => {
      if (event.type === 'tool_execution_end') timeline.push('tool:end')
      if (event.type === 'compaction_start') timeline.push(`compaction:start:${event.reason}`)
      if (event.type === 'compaction_end') timeline.push('compaction:end')
    })
    await session.prompt('Read pages 1-3 and tell me when done.')

    expect(timeline).toEqual([
      'model:agent#1',
      'tool:end',
      'model:agent#2',
      'tool:end',
      'model:agent#3',
      'tool:end',
      'compaction:start:threshold',
      'model:summarize',
      'compaction:end',
      'model:agent#4'
    ])
    const finalPrompt = JSON.stringify(agentCalls[3].messages)
    expect(finalPrompt).toMatch(/SUMMARY-MARKER/)
    expect(finalPrompt).not.toMatch(/PAGE-1 /)
    expect(finalPrompt.length).toBeLessThan(JSON.stringify(agentCalls[2].messages).length)
    expect(lastAssistant(session).content).toEqual([{ type: 'text', text: 'Done reading.' }])

    const compaction = host.entries.find((entry) => entry.type === 'compaction')
    expect(host.events.filter((event) => event.type.startsWith('compaction-'))).toEqual([
      { type: 'compaction-start', reason: 'threshold' },
      { type: 'compaction-end', reason: 'threshold', entryId: compaction?.id, aborted: false }
    ])
    const next = scriptedModel([assistantReply([{ type: 'text', text: 'Next.' }])])
    const rebuilt = await createTestSession({
      stream: next.model,
      model: { ...MODEL, contextWindow: 9_000 },
      tools: [fetchPage],
      entries: host.entries
    })
    await rebuilt.session.prompt('And now?')
    const rebuiltPrompt = JSON.stringify(next.calls[0].messages)
    expect(rebuiltPrompt).toMatch(/SUMMARY-MARKER/)
    expect(rebuiltPrompt).not.toMatch(/PAGE-1 /)
    expect(rebuiltPrompt).toMatch(/Done reading\./)
  })

  it('keeps a compaction rebuildable when Pi keeps from an entry the transcript leaves out', async () => {
    const long = (label: string) => `${label} ${'detail '.repeat(60)}`
    const { model } = scriptedModel([
      assistantReply([{ type: 'text', text: long('ANSWER-ONE') }]),
      assistantReply([{ type: 'text', text: long('ANSWER-TWO') }]),
      assistantReply([{ type: 'text', text: 'SUMMARY-MARKER' }])
    ])
    const host = hostStore()
    const { session } = await createTestSession({
      stream: model,
      // Each message is ~100 tokens: keeping 150 cuts at the second question.
      compaction: { reserveTokens: 16_384, keepRecentTokens: 150 },
      // Pi's cut moves back over entries without context, here a non-`cherry.` custom entry.
      extensionFactories: [
        (pi) => {
          pi.on('agent_settled', () => pi.appendEntry('other.state', { n: 1 }))
        }
      ],
      onEvent: host.onEvent
    })
    await session.prompt(long('QUESTION-ONE'))
    await session.prompt(long('QUESTION-TWO'))
    await session.compact()

    const next = scriptedModel([assistantReply([{ type: 'text', text: 'ok' }])])
    const rebuilt = await createTestSession({ stream: next.model, entries: host.entries })
    await rebuilt.session.prompt('Third')
    const prompt = JSON.stringify(next.calls[0].messages)
    expect(prompt).toMatch(/SUMMARY-MARKER/)
    expect(prompt).not.toMatch(/QUESTION-ONE/)
    expect(prompt).toMatch(/QUESTION-TWO/)
  })

  it('keeps nothing before a compaction whose boundary is not on the branch, live and rebuilt alike', async () => {
    const { model, calls } = scriptedModel([
      assistantReply([{ type: 'text', text: 'ANSWER-ONE' }]),
      assistantReply([{ type: 'text', text: 'ANSWER-TWO' }]),
      assistantReply([{ type: 'text', text: 'ok' }])
    ])
    const host = hostStore()
    const cwd = tempDir('cwd')
    const { session } = await createTestSession({
      cwd,
      stream: model,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 },
      // Another extension writes the compaction, keeping from an entry Pi never had.
      extensionFactories: [
        (pi) => {
          pi.on('session_before_compact', (event) => ({
            compaction: {
              summary: 'EXTERNAL-SUMMARY',
              firstKeptEntryId: 'not-on-branch',
              tokensBefore: event.preparation.tokensBefore
            }
          }))
        }
      ],
      onEvent: host.onEvent
    })
    await session.prompt('QUESTION-ONE')
    await session.prompt('QUESTION-TWO')
    await session.compact()

    const next = scriptedModel([assistantReply([{ type: 'text', text: 'ok' }])])
    const transcript = plain(host.entries)
    const rebuilt = await createTestSession({ cwd, stream: next.model, entries: transcript })
    await session.prompt('Third')
    await rebuilt.session.prompt('Third')
    expect(JSON.stringify(calls.at(-1)!.messages)).not.toMatch(/QUESTION-ONE/)
    expect(next.calls[0].messages.map((message) => ({ ...message, timestamp: 0 }))).toEqual(
      calls.at(-1)!.messages.map((message) => ({ ...message, timestamp: 0 }))
    )
  })
})

describe('host summarizer', () => {
  it('stores the host summary, carries the previous one forward and never asks the session model', async () => {
    const requests: CompactionSummaryRequest[] = []
    const summarize: CompactionSummarizer = async (request) => {
      requests.push(request)
      return `HOST-SUMMARY-${requests.length}`
    }
    const { model, calls } = scriptedModel([assistantReply([{ type: 'text', text: 'Noted.' }])])
    const host = hostStore()
    const { session } = await createTestSession({
      stream: model,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1, summarize },
      onEvent: host.onEvent
    })
    await session.prompt('My name is Li')
    await session.prompt('I live in Paris')
    await session.compact('keep the user facts')
    await session.prompt('I like tea')
    await session.compact()
    await session.prompt('What do you know about me?')

    expect(
      requests.map(({ reason, instructions, previousSummary }) => ({ reason, instructions, previousSummary }))
    ).toEqual([
      { reason: 'manual', instructions: 'keep the user facts', previousSummary: undefined },
      { reason: 'manual', instructions: undefined, previousSummary: 'HOST-SUMMARY-1' }
    ])
    expect(requests[0].messages).toContainEqual(
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'My name is Li' }] })
    )
    expect(host.entries.flatMap((entry) => (entry.type === 'compaction' ? [entry.summary] : []))).toEqual([
      'HOST-SUMMARY-1',
      'HOST-SUMMARY-2'
    ])
    expect(calls).toHaveLength(4)
    const lastPrompt = JSON.stringify(calls[3].messages)
    expect(lastPrompt).toContain('compacted into the following summary')
    expect(lastPrompt).toContain('HOST-SUMMARY-2')
    expect(lastPrompt).not.toContain('My name is Li')
  })

  it('tells the summarizer which session is compacting', async () => {
    const sessionIds: string[] = []
    const { model } = scriptedModel([assistantReply([{ type: 'text', text: 'Noted.' }])])
    const { session } = await createTestSession({
      stream: model,
      compaction: {
        reserveTokens: 16_384,
        keepRecentTokens: 1,
        summarize: async ({ sessionId }) => {
          sessionIds.push(sessionId)
          return 'HOST-SUMMARY'
        }
      }
    })
    await session.prompt('My name is Li')
    await session.compact()

    expect(sessionIds).toEqual([session.sessionId])
  })

  it('hands the native summarizer replayable messages, even after a reply that failed mid tool call', async () => {
    const { model } = scriptedModel([
      {
        ...assistantReply([{ type: 'toolCall', id: 'call_lost', name: 'fetch_page', arguments: { page: 1 } }], 'error'),
        errorMessage: 'connection reset'
      },
      assistantReply([{ type: 'text', text: 'Noted.' }])
    ])
    const summaryModel = scriptedModel([assistantReply([{ type: 'text', text: 'HOST-SUMMARY' }])])
    const binding = await createTestBinding({ stream: summaryModel.model })
    const summarize: CompactionSummarizer = async ({ messages, signal }) => {
      const result = await binding.modelRuntime
        .streamSimple(
          binding.model,
          normalizeContext({
            messages: [...messages, { role: 'user', content: 'Summarize the conversation.', timestamp: Date.now() }]
          }),
          { signal, apiKey: 'fixture', maxRetries: 0 }
        )
        .result()
      if (result.stopReason === 'error') throw new Error(result.errorMessage)
      return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    }
    const host = hostStore()
    const { session } = await createTestSession({
      stream: model,
      tools: [fetchPage],
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1, summarize },
      onEvent: host.onEvent
    })
    await session.prompt('Fetch page 1').catch(() => {})
    await session.prompt('Never mind')
    await session.compact().catch(() => {})

    expect(host.events.filter((event) => event.type === 'compaction-end')).toEqual([
      { type: 'compaction-end', reason: 'manual', entryId: expect.any(String), aborted: false }
    ])
    expect(host.entries.flatMap((entry) => (entry.type === 'compaction' ? [entry.summary] : []))).toEqual([
      'HOST-SUMMARY'
    ])
  })

  it('cancels a threshold compaction whose summarizer fails, without the session model, and finishes the turn', async () => {
    const timeline: string[] = []
    const { model } = pageReader(timeline)
    const host = hostStore()
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: 9_000 },
      tools: [fetchPage],
      compaction: {
        reserveTokens: 2_000,
        keepRecentTokens: 3_000,
        summarize: async () => {
          throw new Error('compression model unavailable')
        }
      },
      onEvent: host.onEvent
    })
    await session.prompt('Read pages 1-3 and tell me when done.')

    expect(timeline).not.toContain('model:summarize')
    expect(lastAssistant(session).content).toEqual([{ type: 'text', text: 'Done reading.' }])
    expect(host.entries.some((entry) => entry.type === 'compaction')).toBe(false)
    const ends = host.events.filter((event) => event.type === 'compaction-end')
    expect(ends.length).toBeGreaterThan(0)
    for (const end of ends)
      expect(end).toEqual({
        type: 'compaction-end',
        reason: 'threshold',
        error: 'compression model unavailable',
        aborted: true
      })
  })
})
