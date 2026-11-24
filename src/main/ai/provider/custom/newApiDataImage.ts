import { type EventSourceMessage, EventSourceParserStream, readResponseWithSizeLimit } from '@ai-sdk/provider-utils'

type ImageContent = { content?: unknown; images?: unknown[] }
type ImageChoice = { index?: number; message?: ImageContent; delta?: ImageContent; finish_reason?: string | null }

class DataImageParser {
  private phase: 'text' | 'bang' | 'label' | 'label-bang' | 'prefix' | 'mime' | 'base64' | 'payload' = 'text'
  private parts: string[] = []
  private position = 0
  private labelDepth = 0
  private labelEscaped = false
  private lineIndent = 0
  private escaped = false
  private code: { marker: string; length: number; fenced: boolean } | undefined
  private delimiter: { marker: string; length: number; atLineStart: boolean } | undefined
  private fenceEnd = false

  private inCode(char: string): boolean {
    const atLineStart = this.lineIndent >= 0 && this.lineIndent <= 3
    if (char === '\n') this.lineIndent = 0
    else if (char === ' ' && this.lineIndent >= 0) this.lineIndent++
    else this.lineIndent = -1

    if (this.delimiter?.marker === char) {
      this.delimiter.length++
      return true
    }
    if (this.delimiter) {
      const { marker, length, atLineStart } = this.delimiter
      if (!this.code && (marker === '`' || length >= 3)) {
        this.code = { marker, length, fenced: atLineStart && length >= 3 }
      } else if (this.code?.marker === marker) {
        if (this.code.fenced && atLineStart && length >= this.code.length) this.fenceEnd = true
        if (!this.code.fenced && length === this.code.length) this.code = undefined
      }
      this.delimiter = undefined
    }

    if (this.fenceEnd) {
      if (char === '\n') this.code = undefined
      if (char !== ' ' && char !== '\t' && char !== '\r') this.fenceEnd = false
      return true
    }
    if (this.code) {
      if (char === this.code.marker && (!this.code.fenced || atLineStart)) {
        this.delimiter = { marker: char, length: 1, atLineStart }
      }
      return true
    }
    if (this.escaped) {
      this.escaped = false
      return true
    }
    if (char === '\\') this.escaped = true
    if (char === '`' || (char === '~' && atLineStart)) {
      this.delimiter = { marker: char, length: 1, atLineStart }
      return true
    }
    return false
  }

  feed(delta: string, final = false): { content: string; images: unknown[] } {
    const text: string[] = []
    const images: unknown[] = []
    let start = 0
    for (let index = 0; index < delta.length; index++) {
      const char = delta[index]
      let valid = true
      switch (this.phase) {
        case 'text':
          if (this.inCode(char) || char !== '!') continue
          text.push(delta.slice(start, index))
          start = index
          this.phase = 'bang'
          continue
        case 'bang':
          valid = char === '['
          if (valid) {
            this.phase = 'label'
            this.labelDepth = 1
            this.labelEscaped = false
          }
          break
        case 'label':
          valid = char !== '\n'
          if (this.labelEscaped) this.labelEscaped = false
          else if (char === '\\') this.labelEscaped = true
          else if (char === '[') this.labelDepth++
          else if (char === ']' && --this.labelDepth === 0) {
            this.phase = 'prefix'
            this.position = 0
          } else if (char === '!') this.phase = 'label-bang'
          break
        case 'label-bang':
          this.phase = 'label'
          if (char !== '[') {
            index--
            continue
          }
          const prefix = this.parts.join('') + delta.slice(start, index)
          text.push(prefix.slice(0, -1))
          this.parts = ['!']
          start = index
          this.labelDepth = 1
          break
        case 'prefix':
          valid = char === '(data:image/'[this.position++]
          if (valid && this.position === '(data:image/'.length) {
            this.phase = 'mime'
            this.position = 0
          }
          break
        case 'mime':
          if (char === ';' && this.position > 0) {
            this.phase = 'base64'
            this.position = 0
          } else {
            valid = /^[^;()\s]$/.test(char)
            this.position++
          }
          break
        case 'base64':
          valid = char === 'base64,'[this.position++]
          if (valid && this.position === 'base64,'.length) {
            this.phase = 'payload'
            this.position = 0
          }
          break
        case 'payload':
          if (char === ')' && this.position > 0) {
            this.parts.push(delta.slice(start, index + 1))
            const markdown = this.parts.join('')
            const url = markdown.slice(markdown.lastIndexOf('](') + 2, -1).replace(/\s+/g, '')
            images.push({ type: 'image_url', image_url: { url } })
            this.parts = []
            this.phase = 'text'
            start = index + 1
          } else {
            valid = /^[A-Za-z0-9+/=\s]$/.test(char)
            this.position++
          }
          break
      }
      if (!valid) {
        text.push(this.parts.join(''), delta.slice(start, index))
        this.parts = []
        this.phase = 'text'
        start = index
        // A rejected candidate can end at the start of another image.
        index--
      }
    }
    if (this.phase === 'text') text.push(delta.slice(start))
    else if (start < delta.length) this.parts.push(delta.slice(start))
    if (final) {
      text.push(this.parts.join(''))
      this.parts = []
      this.phase = 'text'
    }
    return { content: text.join(''), images }
  }
}

function normalizeJson(body: string, pending?: Map<number, DataImageParser>): string {
  if (!pending && !body.includes('!')) return body
  try {
    const value = JSON.parse(body) as { choices?: ImageChoice[] }
    for (const choice of Array.isArray(value?.choices) ? value.choices : []) {
      const target = choice.message ?? choice.delta
      if (!target) continue
      const index = choice.index ?? 0
      const parser = pending?.get(index) ?? new DataImageParser()
      const fed = parser.feed(
        typeof target.content === 'string' ? target.content : '',
        !pending || !!choice.finish_reason
      )
      if (pending && choice.delta) {
        if (choice.finish_reason) pending.delete(index)
        else pending.set(index, parser)
      }
      if (typeof target.content === 'string' || fed.content.length > 0) target.content = fed.content
      if (fed.images.length) target.images = [...(Array.isArray(target.images) ? target.images : []), ...fed.images]
    }
    return JSON.stringify(value)
  } catch {
    return body
  }
}

/** Normalize New API's Markdown data images at the OpenAI-compatible adapter boundary. */
export async function normalizeNewApiDataImages(response: Response): Promise<Response> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || !response.body) return response
  if (!contentType.includes('application/json') && !contentType.includes('text/event-stream')) return response

  // Rewritten bodies no longer match the upstream transfer metadata.
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  const init = { status: response.status, statusText: response.statusText, headers }
  if (contentType.includes('application/json')) {
    const body = await readResponseWithSizeLimit({ response, url: response.url })
    return new Response(normalizeJson(new TextDecoder().decode(body)), init)
  }

  const pending = new Map<number, DataImageParser>()
  const encoder = new TextEncoder()
  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .pipeThrough(
      new TransformStream<EventSourceMessage, Uint8Array>({
        transform(event, controller) {
          if (event.data === '[DONE]') {
            flushPending(controller)
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            return
          }
          const data = normalizeJson(event.data, pending)
          controller.enqueue(encoder.encode(`data: ${data.replaceAll('\n', '\ndata: ')}\n\n`))
        },
        flush: flushPending
      })
    )

  function flushPending(controller: TransformStreamDefaultController<Uint8Array>): void {
    for (const [index, parser] of pending) {
      const { content } = parser.feed('', true)
      if (!content) continue
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index, delta: { content } }] })}\n\n`))
    }
    pending.clear()
  }
  return new Response(stream, init)
}
