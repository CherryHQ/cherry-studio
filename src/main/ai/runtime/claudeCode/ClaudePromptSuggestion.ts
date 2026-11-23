import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'

/** Native suggestions follow a successful result and are cancelled by the CLI on the next command. */
export class ClaudePromptSuggestion {
  private sessionId: string | undefined
  private text = ''
  private readonly listeners = new Set<(text: string) => void>()

  clear(): void {
    this.sessionId = undefined
    this.text = ''

    for (const listener of this.listeners) listener('')
  }

  accept(batch: ClaudeObservation): void {
    if (batch.events.some((event) => event.type === 'gap')) {
      this.clear()

      return
    }

    if (batch.events.some((event) => event.type === 'snapshot')) this.clear()

    for (const { message, source } of batch.native) {
      if (source !== 'live') continue

      if (message.type === 'user' && !message.isSynthetic && !message.parent_tool_use_id) this.clear()

      if (message.type === 'result') {
        this.clear()

        if (message.subtype === 'success' && !message.is_error && !batch.state?.aborted)
          this.sessionId = message.session_id
      } else if (message.type === 'prompt_suggestion' && this.sessionId === message.session_id) {
        this.text = message.suggestion
        this.sessionId = undefined

        for (const listener of this.listeners) listener(this.text)
      } else if (message.type === 'system' && message.subtype === 'compact_boundary') this.clear()
    }
  }

  read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.resolve('')

    if (this.text || !this.sessionId) return Promise.resolve(this.text)

    return new Promise((resolve) => {
      const finish = (text: string) => {
        signal.removeEventListener('abort', abort)
        this.listeners.delete(finish)
        resolve(text)
      }

      const abort = () => finish('')
      this.listeners.add(finish)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
}
