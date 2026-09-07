import type { Protocol } from 'devtools-protocol'

import { sanitizeSnapshotUrl } from '../snapshot/serializeSnapshot'
import type { CdpEvent } from './cdpAllowList'

const MAX_ENTRIES = 200
const MAX_TEXT = 2000
export type ConsoleLevel = 'error' | 'warning' | 'all'

export interface ConsoleMessage {
  level: 'error' | 'warning' | 'info'
  text: string
  timestamp: number
  url: string
}

interface NetworkRequest {
  requestId: string
  method: string
  url: string
  type?: string
  status?: number
  state: 'pending' | 'completed' | 'failed' | 'redirected'
  error?: string
}

function remoteText(arg: Protocol.Runtime.RemoteObject): string {
  if (arg.value === null) return 'null'
  if (['string', 'number', 'boolean'].includes(typeof arg.value)) return String(arg.value).slice(0, MAX_TEXT)
  return (arg.unserializableValue ?? arg.description ?? arg.type).slice(0, MAX_TEXT)
}

function boundedEntries<T>(entries: T[]) {
  let chars = 2
  let start = entries.length
  while (start > 0) {
    const size = JSON.stringify(entries[start - 1]).length + 1
    if (chars + size > 40_000) break
    chars += size
    start--
  }
  return { entries: entries.slice(start), truncated: start > 0 }
}

export class BrowserInspection {
  private messages: ConsoleMessage[] = []
  private requests: NetworkRequest[] = []

  record({ method, params }: CdpEvent): void {
    if (method === 'Runtime.consoleAPICalled') {
      this.addMessage({
        level:
          params.type === 'error' || params.type === 'assert'
            ? 'error'
            : params.type === 'warning'
              ? 'warning'
              : 'info',
        text: params.args.slice(0, 20).map(remoteText).join(' ').slice(0, MAX_TEXT),
        timestamp: params.timestamp,
        url: sanitizeSnapshotUrl(params.stackTrace?.callFrames[0]?.url ?? '').slice(0, MAX_TEXT)
      })
    } else if (method === 'Runtime.exceptionThrown') {
      const exception = params.exceptionDetails
      this.addMessage({
        level: 'error',
        text: (exception.exception?.description ?? exception.text).slice(0, MAX_TEXT),
        timestamp: params.timestamp,
        url: sanitizeSnapshotUrl(exception.url ?? exception.stackTrace?.callFrames[0]?.url ?? '').slice(0, MAX_TEXT)
      })
    } else if (method === 'Network.requestWillBeSent') {
      const previous = this.requests.findLast((request) => request.requestId === params.requestId)
      if (previous && params.redirectResponse) {
        previous.status = params.redirectResponse.status
        previous.state = 'redirected'
      }
      this.requests.push({
        requestId: params.requestId,
        method: params.request.method.slice(0, 80),
        url: sanitizeSnapshotUrl(params.request.url).slice(0, MAX_TEXT),
        type: params.type,
        state: 'pending'
      })
      if (this.requests.length > MAX_ENTRIES) this.requests.shift()
    } else if (
      method === 'Network.responseReceived' ||
      method === 'Network.loadingFinished' ||
      method === 'Network.loadingFailed'
    ) {
      const request = this.requests.findLast((entry) => entry.requestId === params.requestId)
      if (!request) return
      if (method === 'Network.responseReceived') {
        request.status = params.response.status
        request.type = params.type
      } else if (method === 'Network.loadingFinished') request.state = 'completed'
      else {
        request.state = 'failed'
        request.error = params.errorText.slice(0, MAX_TEXT)
      }
    }
  }

  private addMessage(message: ConsoleMessage) {
    this.messages.push(message)
    if (this.messages.length > MAX_ENTRIES) this.messages.shift()
  }

  consoleMessages(level: ConsoleLevel = 'all', clear = false) {
    const selected = this.messages.filter((message) => level === 'all' || message.level === level)
    const result = boundedEntries(selected)
    if (clear) this.messages = this.messages.filter((message) => level !== 'all' && message.level !== level)
    return { messages: result.entries, truncated: result.truncated }
  }

  networkRequests(clear = false) {
    const result = boundedEntries(this.requests)
    if (clear) this.requests = []
    return { requests: result.entries.map((entry) => ({ ...entry })), truncated: result.truncated }
  }

  clear() {
    this.messages = []
    this.requests = []
  }
}
