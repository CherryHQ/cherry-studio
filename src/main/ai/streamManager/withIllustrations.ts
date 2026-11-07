import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import { normalizeIllustrationCount, type IllustrationData } from '@shared/data/types/illustration'

const OPEN = '[[IMAGE]]'
const CLOSE = '[[/IMAGE]]'
const MAX_PROMPT_LENGTH = 16000

export interface IllustrationStreamSink {
  start(id: string): IllustrationData
  complete(id: string, prompt: string, valid: boolean): IllustrationData
}

/** Splits only standalone, non-code illustration markers before the live/persisted stream tee. */
export function withIllustrations(
  stream: ReadableStream<UIMessageChunk>,
  sink: IllustrationStreamSink,
  maxIllustrations = 1
): ReadableStream<UIMessageChunk> {
  const maxCount = normalizeIllustrationCount(maxIllustrations)
  let start: Extract<UIMessageChunk, { type: 'text-start' }> | undefined
  let textId: string | undefined
  let segment = 0
  let pending = ''
  let line = ''
  let fence: string | undefined
  let codeSpanDelimiter = 0
  let backtickRun = 0
  let escaped = false
  let illustrationId: string | undefined
  let ignoredIllustration = false
  let illustrationCount = 0
  let prompt = ''
  let tooLong = false
  let output = ''

  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        const flushText = () => {
          if (!output || !start) return
          if (!textId) {
            textId = `${start.id}:illustration-text:${segment++}`
            controller.enqueue({ ...start, id: textId })
          }
          controller.enqueue({ type: 'text-delta', id: textId, delta: output })
          output = ''
        }
        const endText = () => {
          flushText()
          if (textId) controller.enqueue({ type: 'text-end', id: textId })
          textId = undefined
        }
        const emitData = (data: IllustrationData) =>
          controller.enqueue({ type: 'data-illustration', id: data.id, data })
        const ordinary = (value: string) => {
          output += value
          for (const char of value) {
            // Code spans cross chunks and lines; only an equally long backtick run closes them.
            if (!fence) {
              if (char === '`' && (!escaped || codeSpanDelimiter > 0)) backtickRun++
              else if (backtickRun) {
                if (!codeSpanDelimiter) codeSpanDelimiter = backtickRun
                else if (codeSpanDelimiter === backtickRun) codeSpanDelimiter = 0
                backtickRun = 0
              }
              escaped = !codeSpanDelimiter && char === '\\' && !escaped
            }
            if (char === '\n') {
              const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)
              if (match) {
                const marker = match[1]
                if (!fence) fence = marker
                else if (marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) {
                  fence = undefined
                }
                codeSpanDelimiter = 0
                backtickRun = 0
                escaped = false
              }
              line = ''
            } else if (line.length < MAX_PROMPT_LENGTH) line += char
          }
        }
        if (chunk.type === 'text-start') {
          start = chunk
          segment = 0
          return
        }
        if (chunk.type === 'start') {
          illustrationCount = 0
          controller.enqueue(chunk)
          return
        }
        if (chunk.type === 'text-delta') {
          for (const char of chunk.delta) {
            if (illustrationId) {
              pending += char
              if (pending.endsWith(CLOSE)) {
                const id = illustrationId
                prompt += pending.slice(0, -CLOSE.length)
                pending = ''
                illustrationId = undefined
                const valid = !tooLong && prompt.length <= MAX_PROMPT_LENGTH && !!prompt.trim()
                if (!ignoredIllustration) {
                  if (!valid) illustrationCount--
                  emitData(sink.complete(id, prompt.trim(), valid))
                }
                ignoredIllustration = false
                prompt = ''
                tooLong = false
                line = ''
              } else if (pending.length > CLOSE.length) {
                if (prompt.length < MAX_PROMPT_LENGTH) prompt += pending[0]
                else tooLong = true
                pending = pending.slice(1)
              }
              continue
            }
            if (!fence && !codeSpanDelimiter && line === '') {
              pending += char
              if (pending === OPEN) {
                endText()
                illustrationId = randomUUID()
                pending = ''
                // Consume excess markers too so their hidden prompts never leak into answer text.
                ignoredIllustration = illustrationCount >= maxCount
                if (!ignoredIllustration) {
                  illustrationCount++
                  emitData(sink.start(illustrationId))
                }
              } else if (!OPEN.startsWith(pending)) {
                ordinary(pending)
                pending = ''
              }
            } else ordinary(char)
          }
          flushText()
          return
        }
        if (chunk.type === 'text-end' || chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort') {
          if (illustrationId) {
            if (!ignoredIllustration) {
              illustrationCount--
              emitData(sink.complete(illustrationId, '', false))
            }
            illustrationId = undefined
            ignoredIllustration = false
            prompt = ''
          } else ordinary(pending)
          pending = ''
          endText()
          start = undefined
          line = ''
          fence = undefined
          codeSpanDelimiter = 0
          backtickRun = 0
          escaped = false
          if (chunk.type === 'text-end') return
        }
        controller.enqueue(chunk)
      }
    })
  )
}
