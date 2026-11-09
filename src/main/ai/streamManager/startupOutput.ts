import type { UIMessageChunk } from 'ai'

export function isStartupOutputChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.delta.length > 0
    case 'tool-input-delta':
      return chunk.inputTextDelta.length > 0
    case 'tool-input-available':
    case 'tool-input-error':
    case 'tool-approval-request':
    case 'tool-output-available':
    case 'tool-output-error':
    case 'tool-output-denied':
      return true
    case 'file':
    case 'source-url':
      return chunk.url.length > 0
    case 'source-document':
      return chunk.title.length > 0
    default:
      return false
  }
}
