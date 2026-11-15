import { type EventSourceMessage, EventSourceParserStream } from '@ai-sdk/provider-utils'

// Relays may line-wrap base64 data inside a Markdown image.
const DATA_IMAGE_MARKDOWN = /!\[[^\]]*\]\((data:image\/[^;()\s]+;base64,[A-Za-z0-9+/=\s]+)\)/g
// An open data image that has not received its closing `)` yet.
const DATA_IMAGE_OPEN = /^!\[[^\]]*\]\(data:image\/[^;()\s]+;base64,/

type ImageContent = { content?: unknown; images?: unknown[] }
type ImageChoice = { index?: number; message?: ImageContent; delta?: ImageContent; finish_reason?: string | null }

function extractMarkdownImages(target: ImageContent): void {
  if (typeof target.content !== 'string') return
  target.content = target.content.replace(DATA_IMAGE_MARKDOWN, (_match, url: string) => {
    target.images = [
      ...(Array.isArray(target.images) ? target.images : []),
      { type: 'image_url', image_url: { url: url.replace(/\s+/g, '') } }
    ]
    return ''
  })
}

/** Whether `text` can still grow into `![label](data:image/<type>;base64,` (no closing `)` yet). */
function mayBecomeDataImage(text: string): boolean {
  if (!text.startsWith('!')) return false
  const labelEnd = text.indexOf(']', 1)
  if (labelEnd < 0) return true
  // The label just closed: only a `(` may still follow.
  if (labelEnd + 1 === text.length) return true
  if (text[labelEnd + 1] !== '(') return false
  const target = text.slice(labelEnd + 2)
  if (!target.startsWith('data:image/')) return 'data:image/'.startsWith(target)
  const rest = target.slice('data:image/'.length)
  if (rest.includes(')')) return false
  const params = rest.indexOf(';')
  if (params < 0) return !rest.includes(',')
  return ';base64,'.startsWith(rest.slice(params)) || rest.startsWith(';base64,')
}

/**
 * Append one delta, emitting text that can never become a data image. Once a payload is open
 * only the new bytes are scanned for its `)`, so reassembly stays linear in the payload size.
 */
function feedPending(pending: string, delta: string): { text: string; pending: string } {
  let rest = pending + delta
  let text = ''
  let scannedPrefix = pending.length
  for (;;) {
    const open = DATA_IMAGE_OPEN.exec(rest)
    if (!open) break
    // Everything before this match is settled; only bytes from here on are unscanned.
    const from = Math.max(open[0].length, scannedPrefix)
    const end = rest.indexOf(')', from)
    if (end < 0) return { text, pending: rest }
    scannedPrefix = 0
    // A complete payload stays in the text so `extractMarkdownImages` converts it, then the
    // remainder is scanned again (it may start another image).
    text += rest.slice(0, end + 1)
    rest = rest.slice(end + 1)
  }
  const start = rest.lastIndexOf('!')
  if (start < 0) return { text: text + rest, pending: '' }
  const tail = rest.slice(start)
  return mayBecomeDataImage(tail)
    ? { text: text + rest.slice(0, start), pending: tail }
    : { text: text + rest, pending: '' }
}

function normalizeJson(body: string, pending?: Map<number, string>): string {
  if (!pending?.size && !body.includes('!')) return body
  try {
    const value = JSON.parse(body) as { choices?: ImageChoice[] }
    for (const choice of Array.isArray(value?.choices) ? value.choices : []) {
      const target = choice.message ?? choice.delta
      if (!target) continue
      if (pending && choice.delta) {
        const index = choice.index ?? 0
        const delta = typeof target.content === 'string' ? target.content : ''
        const fed = feedPending(pending.get(index) ?? '', delta)
        // A hold that survives the finish reason would be lost with the stream, so release it.
        const flushed = choice.finish_reason && fed.pending ? fed.text + fed.pending : fed.text
        if (fed.pending && !choice.finish_reason) pending.set(index, fed.pending)
        else pending.delete(index)
        if (typeof target.content === 'string') target.content = flushed
      }
      extractMarkdownImages(target)
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
  if (contentType.includes('application/json')) return new Response(normalizeJson(await response.text()), init)

  const pending = new Map<number, string>()
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
          controller.enqueue(encoder.encode(`data: ${normalizeJson(event.data, pending)}\n\n`))
        },
        flush: flushPending
      })
    )

  function flushPending(controller: TransformStreamDefaultController<Uint8Array>): void {
    for (const [index, content] of pending) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index, delta: { content } }] })}\n\n`))
    }
    pending.clear()
  }
  return new Response(stream, init)
}
