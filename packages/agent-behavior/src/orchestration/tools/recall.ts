import { recallText } from '../../core/context/recall'
import type { ToolDefinition } from '../../ports/harness'

const DESCRIPTION = [
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
].join('\n')
const SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: "What to recall, in plain keywords (e.g. 'redis cache decision')." },
    range: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: '[from, to]: every entry from #from to #to (inclusive) in order, 20 per page.'
    },
    expand: {
      type: 'array',
      items: { type: 'number' },
      description: '#N indices to return full untruncated content for.'
    },
    page: { type: 'number', description: 'Page number (1-based) for query or range results. Default: 1.' },
    scope: {
      type: 'string',
      enum: ['lineage', 'all'],
      description: 'Both cover the current conversation; edited-away turns are not kept.'
    },
    mode: { type: 'string', enum: ['hybrid', 'touched'], description: "Only 'hybrid' (default) is supported." }
  }
}

/** `vcc_recall` (D32): pi-vcc's name and parameters, so existing tool settings and approvals apply; read-only. */
export const recallTool = (): ToolDefinition => ({
  name: 'vcc_recall',
  description: DESCRIPTION,
  schema: SCHEMA,
  replay: 'safe',
  executionMode: 'parallel',
  availability: 'all',
  modelOnly: true,
  run: async (call, ports) => ({
    text: recallText((await ports.ledger.read(call.thread)).history, call.args),
    isError: false
  })
})
