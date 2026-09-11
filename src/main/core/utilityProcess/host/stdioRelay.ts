import { StringDecoder } from 'node:string_decoder'

import { STDIO_LINE_CAP } from '../protocol/constants'

export interface LineDecoder {
  push(chunk: Buffer | string): void
  /** Flushes a trailing partial line; call once when the stream ends. */
  end(): void
}

/**
 * UTF-8-safe line splitter for the child's piped stdout/stderr. Lines longer than `cap` are
 * emitted truncated and the rest of that line is discarded, so a runaway native library can
 * never buffer unbounded output in main.
 */
export function createLineDecoder(
  onLine: (line: string, truncated: boolean) => void,
  cap = STDIO_LINE_CAP
): LineDecoder {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let discarding = false

  const emit = (line: string): void => {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line
    if (clean.length > cap) onLine(clean.slice(0, cap), true)
    else onLine(clean, false)
  }

  const consume = (text: string): void => {
    let start = 0
    for (;;) {
      const newline = text.indexOf('\n', start)
      if (newline === -1) break
      if (discarding) discarding = false
      else emit(pending + text.slice(start, newline))
      pending = ''
      start = newline + 1
    }
    if (discarding) return
    pending += text.slice(start)
    if (pending.length > cap) {
      onLine(pending.slice(0, cap), true)
      pending = ''
      discarding = true
    }
  }

  return {
    push(chunk) {
      consume(typeof chunk === 'string' ? chunk : decoder.write(chunk))
    },
    end() {
      const tail = decoder.end()
      if (tail) consume(tail)
      if (!discarding && pending) emit(pending)
      pending = ''
      discarding = false
    }
  }
}
