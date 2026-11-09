import { EventSourceParserStream } from '@ai-sdk/provider-utils'

import type { PromptProgressPartData } from '@shared/data/types/uiParts'

export type PromptProgressSink = (data: PromptProgressPartData) => void

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function progress(value: unknown): PromptProgressPartData {
  if (!record(value)) return null
  const { total, processed, cache, time_ms: time } = value
  if (
    typeof total !== 'number' ||
    typeof processed !== 'number' ||
    typeof cache !== 'number' ||
    typeof time !== 'number' ||
    ![total, processed, cache, time].every(Number.isFinite) ||
    total <= 0 ||
    cache < 0 ||
    processed > total ||
    processed <= cache ||
    time < 0
  )
    return null
  const percent = (processed / total) * 100
  const etaMs = ((total - processed) * time) / (processed - cache)
  return Number.isFinite(percent) && Number.isFinite(etaMs) ? { percent, etaMs } : null
}

export function createPromptProgressFetch(
  innerFetch: typeof globalThis.fetch,
  sink: PromptProgressSink
): typeof globalThis.fetch {
  return async (input, init) => {
    let body: Record<string, unknown>
    try {
      if (
        init?.method !== 'POST' ||
        typeof init.body !== 'string' ||
        !/\/chat\/completions\/?$/.test(new URL(input instanceof Request ? input.url : input.toString()).pathname)
      ) {
        return innerFetch(input, init)
      }
      const parsed: unknown = JSON.parse(init.body)
      if (!record(parsed) || parsed.stream !== true || !Array.isArray(parsed.messages)) return innerFetch(input, init)
      body = parsed
    } catch {
      return innerFetch(input, init)
    }
    if (!Object.hasOwn(body, 'return_progress')) body.return_progress = true
    const outgoing = { ...init, body: JSON.stringify(body) }
    let response = await innerFetch(input, outgoing)
    if (body.return_progress === true && (response.status === 400 || response.status === 422)) {
      await response.body?.cancel()
      init?.signal?.throwIfAborted()
      delete body.return_progress
      response = await innerFetch(input, { ...outgoing, body: JSON.stringify(body) })
    }
    if (!response.ok || !response.body) return response

    let last: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: PromptProgressPartData = null
    let retired = false
    let published = false
    const clear = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = null
      if (published) sink(null)
      published = false
    }
    const onAbort = () => {
      retired = true
      clear()
    }
    if (init?.signal?.aborted) onAbort()
    else init?.signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => init?.signal?.removeEventListener('abort', onAbort)
    const publish = (value: NonNullable<PromptProgressPartData>) => {
      const now = Date.now()
      if (last === undefined || now - last >= 200) {
        if (timer) clearTimeout(timer)
        timer = undefined
        pending = null
        last = now
        published = true
        sink(value)
      } else {
        pending = value
        if (!timer)
          timer = setTimeout(
            () => {
              timer = undefined
              if (pending && !retired) {
                last = Date.now()
                published = true
                sink(pending)
                pending = null
              }
            },
            200 - (now - last)
          )
      }
    }
    const stream = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeThrough(
        new TransformStream({
          transform(event, controller) {
            let parsed: unknown
            try {
              parsed = JSON.parse(event.data)
            } catch {
              /* Other SSE events are forwarded. */
            }
            if (
              record(parsed) &&
              (Object.hasOwn(parsed, 'error') ||
                (Array.isArray(parsed.choices) &&
                  parsed.choices.some(
                    (choice) =>
                      record(choice) &&
                      record(choice.delta) &&
                      Object.entries(choice.delta).some(
                        ([key, value]) =>
                          key !== 'role' &&
                          value !== null &&
                          value !== undefined &&
                          value !== '' &&
                          (!Array.isArray(value) || value.length > 0)
                      )
                  )))
            ) {
              retired = true
              clear()
            } else if (
              record(parsed) &&
              Object.hasOwn(parsed, 'prompt_progress') &&
              !Object.hasOwn(parsed, 'error') &&
              !Object.hasOwn(parsed, 'usage')
            ) {
              const value = progress(parsed.prompt_progress)
              if (!retired && value) publish(value)
              else if (!value) clear()
              if (parsed.choices === undefined || (Array.isArray(parsed.choices) && parsed.choices.length === 0)) return
            }
            const lines = [
              event.event && `event: ${event.event}`,
              event.id && `id: ${event.id}`,
              ...event.data.split('\n').map((line) => `data: ${line}`)
            ].filter(Boolean)
            controller.enqueue(new TextEncoder().encode(`${lines.join('\n')}\n\n`))
          },
          flush() {
            cleanup()
            clear()
          }
        })
      )
    const reader = stream.getReader()
    const wrapped = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) controller.close()
          else controller.enqueue(result.value)
        } catch (error) {
          cleanup()
          clear()
          controller.error(error)
        }
      },
      async cancel(reason) {
        cleanup()
        clear()
        await reader.cancel(reason)
      }
    })
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    return new Response(wrapped, { status: response.status, statusText: response.statusText, headers })
  }
}
