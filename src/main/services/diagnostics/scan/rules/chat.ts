import type { ScanRule } from '../types'

/** Chat/message streaming failures. */
export const chatRules: readonly ScanRule[] = [
  {
    id: 'chat-stream-error',
    domain: 'chat',
    attribution: 'transient',
    devMessage:
      'A chat response stream failed mid-flight (StreamError / AI stream error); inspect the wrapped cause — often network or provider trouble surfaced downstream.',
    anchors: [/\bStreamError\b|AI stream error/]
  },
  {
    id: 'chat-context-window-exceeded',
    domain: 'chat',
    attribution: 'user-fixable',
    devMessage:
      'The conversation no longer fits the model context window; clearing context, enabling compression, or picking a larger model resolves it.',
    anchors: [
      /maximum context length|context window.{0,30}(?:exceed|limit)|exceeds?.{0,40}context (?:window|length)|prompt is too long|context_length_exceeded/i
    ]
  },
  {
    id: 'chat-tool-use-id-conflict',
    domain: 'chat',
    attribution: 'app-bug',
    devMessage:
      'A request carried duplicate or unmatched tool_use ids, which Anthropic-style APIs reject; the message history was assembled inconsistently.',
    anchors: [/tool_use[\s\S]{0,60}(?:unique|duplicate|without[\s\S]{0,30}tool_result)/i]
  }
]
