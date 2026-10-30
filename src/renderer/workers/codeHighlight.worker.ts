import { LRUCache } from 'lru-cache'
import MarkdownIt from 'markdown-it'

import {
  createCodeBlockDocument,
  createCodeBlockSnapshotExecutor,
  codeBlockToHtml,
  type CodeBlockDocument
} from '@cherrystudio/ui/code-block'
import type { HighlightRequest, HighlightResponse, HighlightValue } from '@renderer/types/codeHighlight'

const documents = new LRUCache<
  string,
  { document: CodeBlockDocument; revision: number; configurationRevision: number }
>({
  max: 50,
  dispose: ({ document }) => document.dispose()
})
const snapshot = createCodeBlockSnapshotExecutor()
class MissingSession extends Error {}

async function handle(request: HighlightRequest): Promise<HighlightValue> {
  if (request.type === 'snapshot') return snapshot(request.request)
  if (request.type === 'close') {
    documents.delete(request.sessionId)
    return null
  }
  if (request.type === 'open') {
    const document = await createCodeBlockDocument(request.code, request.language)
    documents.set(request.sessionId, {
      document,
      revision: request.revision,
      configurationRevision: request.configurationRevision
    })
    return null
  }
  if ('sessionId' in request) {
    const entry = documents.get(request.sessionId)
    if (!entry) throw new MissingSession('Highlight session expired')
    if (request.type === 'update') {
      if (entry.revision !== request.baseRevision || request.revision <= entry.revision)
        throw new Error('Stale source revision')
      entry.document.update(request.change)
      entry.revision = request.revision
      return null
    }
    if (request.type === 'configure') {
      if (request.configurationRevision <= entry.configurationRevision) throw new Error('Stale configuration revision')
      const document = await createCodeBlockDocument(entry.document.code, request.language)
      documents.set(request.sessionId, { ...entry, document, configurationRevision: request.configurationRevision })
      return null
    }
    if (entry.revision !== request.revision || entry.configurationRevision !== request.configurationRevision)
      throw new Error('Stale range read')
    return entry.document.read(request.range)
  }
  if (request.type === 'html') return codeBlockToHtml(request.code, request.language, request.theme)
  const markdown = new MarkdownIt({ linkify: true, typographer: true })
  const tokens = markdown.parse(request.code, {})
  const codeBlocks = tokens.filter((token) => token.type === 'fence' || token.type === 'code_block')
  const highlighted = new Map(
    await Promise.all(
      codeBlocks.map(
        async (token) =>
          [
            token,
            await codeBlockToHtml(token.content, token.info.trim().split(/\s+/)[0] || 'text', request.theme)
          ] as const
      )
    )
  )
  const render = (items: typeof tokens, index: number) => highlighted.get(items[index]) ?? ''
  markdown.renderer.rules.fence = render
  markdown.renderer.rules.code_block = render
  return markdown.renderer.render(tokens, markdown.options, {})
}

type Job = HighlightRequest & { id: number; generation: number }
const jobs: Job[] = []
let processing = false
async function drain() {
  if (processing) return
  processing = true
  while (jobs.length) {
    // Snapshot work has no document ordering dependencies; queued viewport work goes first.
    const index = jobs.findIndex((job) => 'sessionId' in job)
    const data = jobs.splice(index < 0 ? 0 : index, 1)[0]
    try {
      const result = await handle(data)
      self.postMessage({
        id: data.id,
        generation: data.generation,
        result,
        ...('sessionId' in data ? { sessionId: data.sessionId } : {}),
        ...('revision' in data ? { revision: data.revision } : {}),
        ...('configurationRevision' in data ? { configurationRevision: data.configurationRevision } : {})
      } satisfies HighlightResponse)
    } catch (error) {
      self.postMessage({
        id: data.id,
        generation: data.generation,
        error: error instanceof Error ? error.message : String(error),
        missing: error instanceof MissingSession
      } satisfies HighlightResponse)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  processing = false
}
self.onmessage = ({ data }: MessageEvent<Job>) => {
  jobs.push(data)
  void drain()
}
