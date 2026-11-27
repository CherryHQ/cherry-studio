import { pathToFileURL } from 'node:url'

import type { CherryMessagePart } from '../../../../../src/shared/data/types/message'
import type { CherryDataPartTypes } from '../../../../../src/shared/data/types/uiParts'

type PersistedDataKind = Exclude<keyof CherryDataPartTypes, 'retry'>

export const catalogueReport = [
  '## Catalogue review',
  'The inventory and verification steps are documented in [1] and [2].',
  '```mermaid\nflowchart LR\n  A[Parse catalogue] --> B[Verify packages]\n  B --> C[Publish summary]\n```',
  '```html\n<!doctype html>\n<html><head><title>Catalogue readiness</title></head>\n<body><main><h1>Catalogue ready for review</h1><ul><li>24 packages verified</li><li>2 references attached</li></ul></main></body></html>\n```'
].join('\n\n')

export function conversationParts(origin: string, attachment: string, forkSource: string) {
  const data = {
    'imported-status': { type: 'data-imported-status', data: { status: 'interrupted' } },
    error: { type: 'data-error', data: { name: 'Error', message: 'Fixture provider connection closed' } },
    translation: { type: 'data-translation', data: { content: '翻译示例：已核对所有目录。', targetLanguage: 'zh-CN' } },
    video: { type: 'data-video', data: { url: origin + '/sample.mp4' } },
    compact: {
      type: 'data-compact',
      data: { content: 'Fixture original context', compactedContent: 'Fixture summary' }
    },
    'compaction-anchor': {
      type: 'data-compaction-anchor',
      data: { status: 'done', phase: 'in-loop', preTokens: 60_000, postTokens: 19_000, foldedCount: 18 }
    },
    'conversation-reset': { type: 'data-conversation-reset', data: {} },
    'agent-session-fork': { type: 'data-agent-session-fork', data: { sourceSessionId: forkSource } },
    'agent-task-event': {
      type: 'data-agent-task-event',
      data: { event: 'notification', status: 'completed', taskId: 'fixture-task', title: 'Fixture background task' }
    },
    'knowledge-scope': { type: 'data-knowledge-scope', data: { baseIds: [] } },
    clear: { type: 'data-clear', data: {} },
    code: {
      type: 'data-code',
      data: {
        language: 'typescript',
        content: Array.from(
          { length: 96 },
          (_, index) => `export const fixtureRoute${index} = '/reports/${index}'`
        ).join('\n')
      }
    }
  } satisfies { [K in PersistedDataKind]: Extract<CherryMessagePart, { type: `data-${K}` }> }

  const code = [
    '## Workspace inventory',
    '| Source | State |\n| --- | --- |\n' + Array.from({ length: 24 }, (_, i) => `| package-${i} | Ready |`).join('\n'),
    '```text\nworkspace/\n' +
      Array.from({ length: 24 }, (_, i) => `├─ packages/app-${i}/index.ts`).join('\n') +
      '\n```',
    '```diff\n- archived: true\n+ archived: false\n```',
    'The expected rate is $r=n/t$.'
  ].join('\n\n')
  const tools: CherryMessagePart[] = [
    {
      type: 'tool-Bash',
      toolCallId: 'catalogue-shell',
      state: 'output-available',
      input: { command: 'find ./packages -maxdepth 2 -type f' },
      output: Array.from({ length: 400 }, (_, i) => `packages/module-${i}/index.ts`).join('\n')
    },
    {
      type: 'tool-Read',
      toolCallId: 'catalogue-read',
      state: 'output-available',
      input: { file_path: attachment },
      output: 'Read fixture inventory.'
    },
    {
      type: 'tool-Edit',
      toolCallId: 'catalogue-edit',
      state: 'output-available',
      input: {
        file_path: attachment,
        old_string: 'state: pending\nowner: inventory',
        new_string: 'state: verified\nowner: inventory\nreviewed: true'
      },
      output: 'Updated fixture inventory.'
    },
    {
      type: 'tool-Glob',
      toolCallId: 'catalogue-glob',
      state: 'output-available',
      input: { pattern: 'packages/**/*.ts' },
      output: Array.from({ length: 180 }, (_, index) => `/workspace/packages/app-${index}/index.ts`).join('\n')
    },
    {
      type: 'tool-Grep',
      toolCallId: 'catalogue-grep',
      state: 'output-available',
      input: { pattern: 'export const', path: '/workspace/packages' },
      output: Array.from(
        { length: 120 },
        (_, index) => `/workspace/packages/app-${index}/index.ts:1:export const enabled = true`
      ).join('\n')
    },
    {
      type: 'tool-TodoWrite',
      toolCallId: 'catalogue-plan',
      state: 'output-available',
      input: {
        todos: [
          { content: 'Inventory packages', status: 'completed' },
          { content: 'Review index files', status: 'in_progress' },
          { content: 'Prepare the summary', status: 'pending' }
        ]
      },
      output: 'Updated the fixture plan.'
    },
    {
      type: 'tool-web_search',
      toolCallId: 'catalogue-web-search',
      state: 'output-available',
      input: { query: 'workspace inventory' },
      output: {
        results: [
          {
            title: 'Fixture inventory guide',
            url: origin + '/gallery.png',
            content: 'One result from the loopback fixture.'
          }
        ]
      }
    },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__fixture__search',
      toolCallId: 'catalogue-search',
      state: 'output-available',
      input: { query: 'workspace inventory' },
      output: {
        content: [
          { type: 'text', text: 'Fixture MCP payload. '.repeat(4_000) },
          { type: 'resource_link', name: 'Fixture image', uri: origin + '/gallery.png', mimeType: 'image/png' }
        ]
      }
    },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__fixture__fetch',
      toolCallId: 'catalogue-failed',
      state: 'output-error',
      input: { key: 'fixture-missing' },
      errorText: 'Fixture tool failed with ENOENT'
    }
  ]
  const history: CherryMessagePart[][] = [
    [
      { type: 'step-start' },
      { type: 'reasoning', state: 'done', text: 'Fixture reasoning precedes the reply. '.repeat(30) },
      ...tools,
      { type: 'source-url', sourceId: 'fixture-link', url: origin + '/gallery.png', title: 'Fixture link' },
      { type: 'source-document', sourceId: 'fixture-doc', mediaType: 'text/plain', title: 'Fixture inventory' },
      { type: 'text', state: 'done', text: code }
    ],
    [
      ...Array.from(
        { length: 8 },
        (_, index): CherryMessagePart => ({
          type: 'file',
          mediaType: 'image/png',
          filename: `gallery-${index}.png`,
          url: origin + (index === 0 ? '/large.png' : `/gallery.png?${index}`)
        })
      ),
      { type: 'file', mediaType: 'text/plain', filename: 'fixture-inventory.txt', url: pathToFileURL(attachment).href },
      data.video
    ],
    [
      data.translation,
      data.code,
      {
        type: 'text',
        text: catalogueReport,
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'web',
                content: {
                  source: 'websearch',
                  results: [
                    { number: 1, url: origin + '/gallery.png', title: 'Fixture inventory manual' },
                    { number: 2, url: origin + '/sample.mp4', title: 'Fixture verification walkthrough' }
                  ]
                }
              }
            ]
          }
        }
      }
    ],
    [data.compact, data['compaction-anchor']],
    [data['conversation-reset'], data['agent-session-fork']],
    [data['imported-status'], data.error],
    [data['agent-task-event'], data['knowledge-scope']]
  ]
  return { history, clear: data.clear, code }
}
