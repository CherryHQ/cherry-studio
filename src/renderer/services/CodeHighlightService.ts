import { escapeCode as escape, plainTokens, type SnapshotExecutor } from '@cherrystudio/ui/code-highlight'
import { loggerService } from '@logger'
import type {
  HighlightRange,
  HighlightRequest,
  HighlightResponse,
  HighlightResult,
  HighlightValue
} from '@renderer/types/codeHighlight'

const logger = loggerService.withContext('CodeHighlightService')

class MissingSession extends Error {}
interface Session {
  id: string
  code: string
  language: string
  theme: string
  revision: number
  configurationRevision: number
  generation: number
  closed: boolean
  tail: Promise<unknown>
}
class CodeHighlightService {
  private generation = 0
  private nextSessionId = 0
  private sessions = new Map<string, Session>()
  private worker: Worker | null = null
  private nextId = 0
  private pending = new Map<
    number,
    {
      resolve: (result: HighlightValue) => void
      reject: (error: Error) => void
      request: HighlightRequest
    }
  >()

  private request(request: HighlightRequest): Promise<HighlightValue> {
    if (!this.worker) {
      const worker = new Worker(new URL('../workers/codeHighlight.worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      this.generation++
      worker.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
        if (this.worker !== worker || data.generation !== this.generation) return
        const pending = this.pending.get(data.id)
        if ('error' in data) pending?.reject(data.missing ? new MissingSession(data.error) : new Error(data.error))
        else if (pending) {
          const expected = pending.request
          if (
            expected.type === 'read' &&
            (data.sessionId !== expected.sessionId ||
              data.revision !== expected.revision ||
              data.configurationRevision !== expected.configurationRevision)
          )
            pending.reject(new Error('Mismatched highlight response'))
          else pending.resolve(data.result)
        }
      }
      worker.onerror = () => {
        if (this.worker === worker) this.dispose(new Error('Code highlight worker failed'))
      }
      worker.onmessageerror = () => {
        if (this.worker === worker) this.dispose(new Error('Invalid code highlight worker response'))
      }
    }
    const worker = this.worker
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.worker === worker) this.dispose(new Error('Code highlight worker timed out'))
      }, 30_000)
      const finish = () => {
        clearTimeout(timer)
        this.pending.delete(id)
      }
      this.pending.set(id, {
        request,
        resolve: (result) => {
          finish()
          resolve(result)
        },
        reject: (error) => {
          finish()
          reject(error)
        }
      })
      try {
        worker.postMessage({ ...request, id, generation: this.generation })
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async highlightRange(
    code: string,
    language: string,
    theme: string,
    callerId: string,
    range: HighlightRange
  ): Promise<HighlightResult> {
    let session = this.sessions.get(callerId)
    if (!session) {
      session = {
        id: `${callerId}:${this.nextSessionId++}`,
        code: '',
        language,
        theme,
        revision: 0,
        configurationRevision: 0,
        generation: -1,
        closed: false,
        tail: Promise.resolve()
      }
      this.sessions.set(callerId, session)
    }
    const current = session
    const run = async () => {
      if (current.closed) throw new Error('Highlight session closed')
      const open = async () => {
        await this.request({
          type: 'open',
          sessionId: current.id,
          code,
          language,
          theme,
          revision: current.revision,
          configurationRevision: current.configurationRevision
        })
        current.code = code
        current.language = language
        current.theme = theme
        current.generation = this.generation
      }
      const read = async () => {
        if (current.closed) throw new Error('Highlight session closed')
        const result = await this.request({
          type: 'read',
          sessionId: current.id,
          revision: current.revision,
          configurationRevision: current.configurationRevision,
          range
        })
        if (current.closed) throw new Error('Highlight session closed')
        if (result && typeof result !== 'string' && 'lines' in result) return result
        throw new Error('Expected highlighted lines')
      }
      try {
        if (!this.worker || current.generation !== this.generation) await open()
        else {
          if (code !== current.code) {
            const lines = current.code.split('\n')
            const end = { line: lines.length - 1, character: lines.at(-1)!.length }
            await this.request({
              type: 'update',
              sessionId: current.id,
              baseRevision: current.revision,
              revision: current.revision + 1,
              change: code.startsWith(current.code)
                ? { type: 'edits', edits: [{ range: { start: end, end }, newText: code.slice(current.code.length) }] }
                : { type: 'replace', code }
            })
            current.code = code
            current.revision++
          }
          if (language !== current.language || theme !== current.theme) {
            await this.request({
              type: 'configure',
              sessionId: current.id,
              configurationRevision: current.configurationRevision + 1,
              language,
              theme
            })
            current.language = language
            current.theme = theme
            current.configurationRevision++
          }
        }
        return await read()
      } catch (error) {
        if (!(error instanceof MissingSession) || current.closed) throw error
        await open()
        return read()
      }
    }
    const task = current.tail.then(run)
    current.tail = task.catch(() => {})
    try {
      return await task
    } catch (error) {
      logger.warn('Code highlighting unavailable; displaying plain text', error as Error)
      return { start: range.start, lines: plainTokens(code).tokens.slice(range.start, range.end) }
    }
  }

  highlightSnapshot: SnapshotExecutor = async (request) => {
    const result = await this.request({ type: 'snapshot', request: { ...request, foreground: 'var(--foreground)' } })
    if (result && typeof result !== 'string' && 'tokens' in result) return result
    throw new Error('Expected snapshot tokens')
  }

  async highlightCodeToHtml(code: string, language: string, theme: string): Promise<string> {
    try {
      const result = await this.request({ type: 'html', code, language, theme })
      if (typeof result === 'string') return result
      throw new Error('Expected highlighted HTML')
    } catch (error) {
      logger.warn('Code highlighting unavailable; displaying plain text', error as Error)
      return `<pre class="shiki"><code>${escape(code)}</code></pre>`
    }
  }

  async renderMarkdown(code: string, theme: string): Promise<string> {
    try {
      const result = await this.request({ type: 'markdown', code, theme })
      if (typeof result !== 'string') throw new Error('Expected rendered Markdown')
      return result
    } catch (error) {
      logger.warn('Markdown rendering unavailable; displaying source text', error as Error)
      return `<pre><code>${escape(code)}</code></pre>`
    }
  }

  cleanupTokenizers(callerId: string): void {
    const session = this.sessions.get(callerId)
    if (!session) return
    session.closed = true
    this.sessions.delete(callerId)
    // Queue close immediately: a replacement with the same ID must open after it.
    if (this.worker)
      void this.request({ type: 'close', sessionId: session.id }).catch((error) =>
        logger.debug('Highlight cleanup interrupted', error)
      )
  }

  dispose(error = new Error('Code highlight worker disposed')): void {
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export const codeHighlightService = new CodeHighlightService()

if (import.meta.hot) import.meta.hot.dispose(() => codeHighlightService.dispose())
