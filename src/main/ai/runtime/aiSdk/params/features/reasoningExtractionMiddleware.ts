import type { LanguageModelV3Content, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

/**
 * Anchored inline-reasoning extraction.
 *
 * Only the one `<tag>…</tag>` block that opens the reply is reasoning — in the
 * text channel, after leading whitespace, and only when the wire delivered no
 * structured reasoning part. AI SDK's `extractReasoningMiddleware` instead
 * toggles on every tag pair, so a literal tag inside an answer reclassified the
 * rest of that answer as reasoning and the tail vanished from the reply.
 *
 * An unclosed leading tag keeps the old semantics: everything after it is
 * reasoning (R1-style templates emit no closing tag).
 */

/** Namespaced so a provider `reasoning-0` still arriving later cannot collide. */
const REASONING_PART_ID = 'extraction-0'

type StreamPhase = 'probe' | 'extract' | 'after'

export function createAnchoredReasoningExtraction(tagName: string): LanguageModelMiddleware {
  const openingTag = `<${tagName}>`
  const closingTag = `</${tagName}>`

  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      return { ...result, content: splitLeadingBlock(result.content, openingTag, closingTag) }
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      return { stream: toReadableStream(anchoredChunks(stream, openingTag, closingTag)), ...rest }
    }
  }
}

/** Non-streaming counterpart: same two rules, applied to the finished parts. */
function splitLeadingBlock(
  content: LanguageModelV3Content[],
  openingTag: string,
  closingTag: string
): LanguageModelV3Content[] {
  if (content.some((part) => part.type === 'reasoning')) return content

  const index = content.findIndex((part) => part.type === 'text')
  if (index < 0) return content

  const textPart = content[index]
  if (textPart.type !== 'text') return content

  const text = textPart.text
  const trimmed = text.trimStart()
  if (!trimmed.startsWith(openingTag)) return content

  const body = trimmed.slice(openingTag.length)
  const end = body.indexOf(closingTag)
  const next = [...content]
  next.splice(
    index,
    1,
    { type: 'reasoning', text: end >= 0 ? body.slice(0, end) : body },
    {
      type: 'text',
      text: text.slice(0, text.length - trimmed.length) + (end >= 0 ? body.slice(end + closingTag.length) : '')
    }
  )
  return next
}

async function* anchoredChunks(
  source: ReadableStream<LanguageModelV3StreamPart>,
  openingTag: string,
  closingTag: string
): AsyncGenerator<LanguageModelV3StreamPart> {
  const reader = source.getReader()
  /** Anchor text-start + deltas, withheld until the probe decides the whole stream. */
  const held: LanguageModelV3StreamPart[] = []
  let anchorId: string | undefined
  let heldTextStart: LanguageModelV3StreamPart | undefined
  let leading = ''
  let phase: StreamPhase = 'probe'
  let scanBuffer = ''
  let pendingText = ''
  let reasoningOpen = false
  let textOpen = false

  const readPhase = (): StreamPhase => phase

  const passthrough = (out: LanguageModelV3StreamPart[]): void => {
    phase = 'after'
    out.push(...held)
    held.length = 0
    textOpen = heldTextStart !== undefined
  }

  /** The anchor's text part is opened late so it lands after the reasoning part. */
  const openText = (out: LanguageModelV3StreamPart[], force = false): void => {
    if (textOpen || anchorId === undefined) return
    if (!force && pendingText.trim() === '') return
    out.push(heldTextStart ?? { type: 'text-start', id: anchorId })
    out.push({ type: 'text-delta', id: anchorId, delta: pendingText })
    pendingText = ''
    textOpen = true
  }

  const closeBlock = (out: LanguageModelV3StreamPart[]): void => {
    if (scanBuffer) {
      out.push({ type: 'reasoning-delta', id: REASONING_PART_ID, delta: scanBuffer })
      scanBuffer = ''
    }
    if (reasoningOpen) {
      out.push({ type: 'reasoning-end', id: REASONING_PART_ID })
      reasoningOpen = false
    }
    phase = 'after'
  }

  const scan = (text: string, out: LanguageModelV3StreamPart[]): void => {
    scanBuffer += text
    const end = scanBuffer.indexOf(closingTag)
    if (end >= 0) {
      const body = scanBuffer.slice(0, end)
      if (body) out.push({ type: 'reasoning-delta', id: REASONING_PART_ID, delta: body })
      out.push({ type: 'reasoning-end', id: REASONING_PART_ID })
      reasoningOpen = false
      pendingText += scanBuffer.slice(end + closingTag.length)
      scanBuffer = ''
      phase = 'after'
      openText(out)
      return
    }
    // Hold back a partial closing tag: it may be split across chunks.
    const keep = closingTag.length - 1
    if (scanBuffer.length > keep) {
      out.push({
        type: 'reasoning-delta',
        id: REASONING_PART_ID,
        delta: scanBuffer.slice(0, scanBuffer.length - keep)
      })
      scanBuffer = scanBuffer.slice(scanBuffer.length - keep)
    }
  }

  const probe = (chunk: LanguageModelV3StreamPart, out: LanguageModelV3StreamPart[]): void => {
    if (chunk.type === 'text-start') {
      if (anchorId === undefined) {
        anchorId = chunk.id
        heldTextStart = chunk
        held.push(chunk)
        return
      }
      passthrough(out)
      out.push(chunk)
      return
    }
    if (chunk.type === 'text-delta') {
      if (chunk.id !== anchorId) {
        passthrough(out)
        out.push(chunk)
        return
      }
      leading += chunk.delta
      const trimmed = leading.trimStart()
      if (trimmed.startsWith(openingTag)) {
        phase = 'extract'
        held.length = 0
        pendingText = leading.slice(0, leading.length - trimmed.length)
        out.push({ type: 'reasoning-start', id: REASONING_PART_ID })
        reasoningOpen = true
        scan(trimmed.slice(openingTag.length), out)
        return
      }
      if (trimmed === '' || openingTag.startsWith(trimmed)) {
        held.push(chunk)
        return
      }
      passthrough(out)
      out.push(chunk)
      return
    }
    if (chunk.type === 'text-end') {
      if (chunk.id !== anchorId) {
        out.push(chunk)
        return
      }
      // An empty text part is not an anchor: keep waiting for the next one.
      if (leading === '') {
        held.length = 0
        heldTextStart = undefined
        anchorId = undefined
        return
      }
      passthrough(out)
      out.push(chunk)
      return
    }
    // A structured reasoning chunk means the wire has a native reasoning channel.
    if (chunk.type === 'reasoning-delta' && chunk.delta === '') {
      out.push(chunk)
      return
    }
    if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta' || chunk.type === 'reasoning-end') {
      passthrough(out)
      out.push(chunk)
      return
    }
    if (chunk.type === 'finish') {
      passthrough(out)
      out.push(chunk)
      return
    }
    out.push(chunk)
  }

  const extract = (chunk: LanguageModelV3StreamPart, out: LanguageModelV3StreamPart[]): void => {
    if (chunk.type === 'text-delta') {
      if (chunk.id === anchorId) scan(chunk.delta, out)
      else out.push(chunk)
      return
    }
    if (chunk.type === 'text-end') {
      // We never opened a text part, so the provider's end marker has no counterpart.
      if (chunk.id === anchorId) closeBlock(out)
      else out.push(chunk)
      return
    }
    if (chunk.type === 'finish') {
      closeBlock(out)
      out.push(chunk)
      return
    }
    if (chunk.type === 'text-start') {
      closeBlock(out)
      out.push(chunk)
      return
    }
    out.push(chunk)
  }

  const after = (chunk: LanguageModelV3StreamPart, out: LanguageModelV3StreamPart[]): void => {
    if (chunk.type === 'text-delta' && chunk.id === anchorId && !textOpen) openText(out, true)
    // A text part we deliberately never opened must not be ended either.
    if (chunk.type === 'text-end' && chunk.id === anchorId && !textOpen) return
    out.push(chunk)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const out: LanguageModelV3StreamPart[] = []
      if (phase === 'probe') probe(value, out)
      else if (phase === 'extract') extract(value, out)
      else after(value, out)
      for (const part of out) yield part
    }

    // Read through a call: the handlers above mutate `phase` inside closures, which
    // control-flow analysis cannot see.
    const tail: LanguageModelV3StreamPart[] = []
    if (readPhase() === 'extract') closeBlock(tail)
    if (readPhase() === 'after') openText(tail)
    for (const part of tail) yield part
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The source is already errored or closed — nothing left to cancel.
    }
    reader.releaseLock()
  }
}

function toReadableStream(
  iterator: AsyncGenerator<LanguageModelV3StreamPart>
): ReadableStream<LanguageModelV3StreamPart> {
  const source = iterator[Symbol.asyncIterator]()
  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(controller) {
      const { done, value } = await source.next()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    async cancel() {
      await source.return(undefined)
    }
  })
}
