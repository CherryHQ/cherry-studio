import type { JsonValue } from '@cherrystudio/agent-runtime'

import { fieldsOf, numberField, stringField } from '../args'
import { encodeEntry } from '../entryCodec'
import type { HistoryEntry } from '../facts'

const SEARCH_PAGE = 5
const RANGE_PAGE = 20
const CLIP = 300

type Recalled = { readonly index: number; readonly label: string; readonly text: string }

/** `#N` numbers the messages of the full lineage, compaction-folded ones included (README context); records are not messages. */
function recallable(history: readonly HistoryEntry[]): Recalled[] {
  const recalled: Recalled[] = []
  const push = (label: string, text: string) => recalled.push({ index: recalled.length, label, text })
  for (const entry of history) {
    if (entry.kind === 'user') push('user', entry.text)
    else if (entry.kind === 'assistant')
      push(
        'assistant',
        [entry.text, ...entry.toolCalls.map((call) => `${call.name}(${JSON.stringify(call.args)})`)]
          .filter(Boolean)
          .join('\n')
      )
    else if (entry.kind === 'tool-result') push(`tool_result:${entry.tool}`, entry.text)
    else if (entry.kind === 'marker') push(`custom:${encodeEntry(entry.marker).kind}`, entry.text)
  }
  return recalled
}

const line = ({ index, label, text }: Recalled, snippet = text) => `#${index} [${label}] ${snippet}`
function clipAround(text: string, at: number): string {
  const start = Math.max(0, Math.min(at - CLIP / 3, text.length - CLIP))
  const clipped = text.slice(start, start + CLIP).replace(/\s+/g, ' ')
  return `${start > 0 ? '…' : ''}${clipped}${start + CLIP < text.length ? '…' : ''}`
}
function page<T>(items: readonly T[], size: number, requested: number | undefined) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, Math.floor(requested ?? 1)), pages)
  const more = current < pages ? `\n--- page ${current}/${pages}; use page:${current + 1} for more ---` : ''
  return { items: items.slice((current - 1) * size, current * size), more }
}
function search(entries: readonly Recalled[], query: string, requested: number | undefined): string {
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
  const { items, more } = page(hits, SEARCH_PAGE, requested)
  const lines = items.map(({ entry, at }) => line(entry, clipAround(entry.text, at)))
  return `${hits.length} entries match "${query}" (full text: expand:[N])\n${lines.join('\n')}${more}`
}
function range(entries: readonly Recalled[], from: number, to: number, requested: number | undefined): string {
  const selected = entries.filter(({ index }) => index >= from && index <= to)
  if (selected.length === 0) return `No entries in #${from}..#${to}; this session has #0..#${entries.length - 1}.`
  const { items, more } = page(selected, RANGE_PAGE, requested)
  return items.map((entry) => line(entry, clipAround(entry.text, 0))).join('\n') + more
}
function expand(entries: readonly Recalled[], indices: readonly number[]): string {
  const missing = indices.filter((index) => !entries[index])
  if (missing.length > 0)
    return `No entries ${missing.map((i) => `#${i}`).join(', ')}; this session has #0..#${entries.length - 1}.`
  return indices.map((index) => line(entries[index])).join('\n\n')
}
const numbers = (value: JsonValue | undefined): readonly number[] | undefined =>
  Array.isArray(value) && value.every((item): item is number => typeof item === 'number') ? value : undefined

/** `vcc_recall` (D32): pi-vcc's name and parameters; one of expand, query or range per call, else the latest entries. */
export function recallText(history: readonly HistoryEntry[], args: JsonValue | undefined): string {
  const fields = fieldsOf(args)
  const entries = recallable(history)
  const requested = numberField(fields, 'page')
  const expanded = numbers(fields?.expand)
  const query = stringField(fields, 'query')?.trim()
  const span = numbers(fields?.range)
  if (stringField(fields, 'mode') === 'touched') return "mode:'touched' is not available here; use query or range."
  if (expanded?.length) return expand(entries, expanded)
  if (query) return search(entries, query, requested)
  if (span?.length === 2) return range(entries, span[0], span[1], requested)
  return range(entries, entries.length - RANGE_PAGE, entries.length - 1, undefined)
}
