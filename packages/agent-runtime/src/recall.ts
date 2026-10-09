import { Type } from '@earendil-works/pi-ai'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { TranscriptEntry, TranscriptMessageEntry } from './transcript'

const SEARCH_PAGE = 5
const RANGE_PAGE = 20
const CLIP = 300

interface Recalled {
  /** `#N`: position among the session's message entries, stable once the host stores them in order. */
  index: number
  label: string
  text: string
}

function render(entry: TranscriptMessageEntry, index: number): Recalled {
  const { message } = entry
  const parts =
    typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content
  const text = parts
    .flatMap((part) => {
      switch (part.type) {
        case 'text':
          return [part.text]
        case 'image':
          return ['[image]']
        case 'tool-call':
          return [`${part.toolName}(${JSON.stringify(part.input)})`]
        case 'tool-result':
          return [
            part.output.type === 'text' || part.output.type === 'error-text'
              ? part.output.value
              : part.output.type === 'content'
                ? part.output.value.map((item) => (item.type === 'text' ? item.text : '[image]')).join('\n')
                : JSON.stringify(part.output)
          ]
        default:
          return []
      }
    })
    .join('\n')
  const toolName = message.role === 'tool' && message.content[0]?.type === 'tool-result' && message.content[0].toolName
  const label = entry.custom ? `custom:${entry.custom.type}` : toolName ? `tool_result:${toolName}` : message.role
  return { index, label, text }
}

function recallable(transcript: readonly TranscriptEntry[]): Recalled[] {
  return transcript.filter((entry): entry is TranscriptMessageEntry => entry.kind === 'message').map(render)
}

const line = ({ index, label, text }: Recalled, snippet = text) => `#${index} [${label}] ${snippet}`

function clipAround(text: string, at: number): string {
  const start = Math.max(0, Math.min(at - CLIP / 3, text.length - CLIP))
  const clipped = text.slice(start, start + CLIP).replace(/\s+/g, ' ')
  return `${start > 0 ? '…' : ''}${clipped}${start + CLIP < text.length ? '…' : ''}`
}

function page<T>(items: T[], size: number, requested: number | undefined) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, Math.floor(requested ?? 1)), pages)
  const more = current < pages ? `\n--- page ${current}/${pages}; use page:${current + 1} for more ---` : ''
  return { items: items.slice((current - 1) * size, current * size), more }
}

function search(entries: Recalled[], query: string, requestedPage: number | undefined): string {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
  const hits = entries
    .map((entry) => {
      const lower = entry.text.toLowerCase()
      const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0)
      return { entry, score: positions.length, at: Math.min(...positions) }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.index - a.entry.index)
  if (hits.length === 0) return `No entries match "${query}".`
  const { items, more } = page(hits, SEARCH_PAGE, requestedPage)
  const lines = items.map(({ entry, at }) => line(entry, clipAround(entry.text, at)))
  return `${hits.length} entries match "${query}" (full text: expand:[N])\n${lines.join('\n')}${more}`
}

function range(entries: Recalled[], from: number, to: number, requestedPage: number | undefined): string {
  const selected = entries.filter(({ index }) => index >= from && index <= to)
  if (selected.length === 0) return `No entries in #${from}..#${to}; this session has #0..#${entries.length - 1}.`
  const { items, more } = page(selected, RANGE_PAGE, requestedPage)
  return items.map((entry) => line(entry, clipAround(entry.text, 0))).join('\n') + more
}

function expand(entries: Recalled[], indices: number[]): string {
  const missing = indices.filter((index) => !entries[index])
  if (missing.length > 0)
    return `No entries ${missing.map((i) => `#${i}`).join(', ')}; this session has #0..#${entries.length - 1}.`
  return indices.map((index) => line(entries[index])).join('\n\n')
}

/**
 * `vcc_recall`: same name and parameters as pi-vcc's tool, so existing tool settings and approvals
 * apply. It reads the session's transcript: the full replayed path plus every entry since.
 */
export function recallExtension(transcript: () => readonly TranscriptEntry[]): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'vcc_recall',
      label: 'VCC Recall',
      description: [
        'Recall earlier parts of this session, including anything dropped by compaction.',
        'Use it before saying the context is gone.',
        '',
        'Pick one per call:',
        '- query: keyword search; entries matching more of the words come first, 5 per page.',
        '- range: [from, to]: entries #from..#to in order, 20 per page.',
        '- expand: [N, ...]: full untruncated text of those entries.',
        'With no argument, the latest entries are listed.',
        '',
        '#N is the entry number shown in recall results. Only the current session is searchable.'
      ].join('\n'),
      promptSnippet:
        'vcc_recall: recall earlier parts of this session before saying the context is gone. ' +
        'One per call: query (keyword search), range:[from, to] (entries in order), expand:[N] (full text).',
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({ description: "What to recall, in plain keywords (e.g. 'redis cache decision')." })
        ),
        range: Type.Optional(
          Type.Array(Type.Number(), {
            minItems: 2,
            maxItems: 2,
            description: '[from, to]: every entry from #from to #to (inclusive) in order, 20 per page.'
          })
        ),
        expand: Type.Optional(
          Type.Array(Type.Number(), { description: '#N indices to return full untruncated content for.' })
        ),
        page: Type.Optional(
          Type.Number({ description: 'Page number (1-based) for query or range results. Default: 1.' })
        ),
        scope: Type.Optional(
          Type.Union([Type.Literal('lineage'), Type.Literal('all')], {
            description: 'Both cover the current conversation; edited-away turns are not kept.'
          })
        ),
        mode: Type.Optional(
          Type.Union([Type.Literal('hybrid'), Type.Literal('touched')], {
            description: "Only 'hybrid' (default) is supported."
          })
        )
      }),
      async execute(_toolCallId, params) {
        const entries = recallable(transcript())
        const text =
          params.mode === 'touched'
            ? "mode:'touched' is not available here; use query or range."
            : params.expand?.length
              ? expand(entries, params.expand)
              : params.query?.trim()
                ? search(entries, params.query.trim(), params.page)
                : params.range
                  ? range(entries, params.range[0], params.range[1], params.page)
                  : range(entries, entries.length - RANGE_PAGE, entries.length - 1, undefined)
        return { content: [{ type: 'text', text }], details: undefined }
      }
    })
  }
}
