import { LRUCache } from 'lru-cache'
import MarkdownIt from 'markdown-it'

import {
  createSnapshotExecutor,
  loadCodeHighlightRuntime,
  type HighlightDocument
} from '@cherrystudio/ui/code-highlight'
import type { HighlightRequest, HighlightResponse, HighlightValue } from '@renderer/types/codeHighlight'
import { loadCodeTheme } from '@renderer/utils/codeHighlight'

const documents = new LRUCache<
  string,
  { document: HighlightDocument; revision: number; configurationRevision: number }
>({
  max: 50,
  dispose: ({ document }) => document.dispose()
})
const snapshot = createSnapshotExecutor()
class MissingSession extends Error {}

async function handle(request: HighlightRequest): Promise<HighlightValue> {
  if (request.type === 'snapshot') return snapshot(request.request)
  if (request.type === 'close') {
    documents.delete(request.sessionId)
    return null
  }
  if (request.type === 'open') {
    const [runtime, theme] = await Promise.all([loadCodeHighlightRuntime(), loadCodeTheme(request.theme)])
    documents.set(request.sessionId, {
      document: runtime.createDocument(request.code, request.language, theme),
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
      const [runtime, theme] = await Promise.all([loadCodeHighlightRuntime(), loadCodeTheme(request.theme)])
      const document = runtime.createDocument(entry.document.code, request.language, theme)
      documents.set(request.sessionId, { ...entry, document, configurationRevision: request.configurationRevision })
      return null
    }
    if (entry.revision !== request.revision || entry.configurationRevision !== request.configurationRevision)
      throw new Error('Stale range read')
    return entry.document.read(request.range)
  }
  const [runtime, theme] = await Promise.all([loadCodeHighlightRuntime(), loadCodeTheme(request.theme)])
  const highlight = (code: string, language: string) =>
    runtime.codeToHtml(code, language, theme).replace('class="highlights"', 'class="shiki highlights"')
  if (request.type === 'html') return highlight(request.code, request.language)
  return new MarkdownIt({ linkify: true, typographer: true, highlight }).render(request.code)
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
