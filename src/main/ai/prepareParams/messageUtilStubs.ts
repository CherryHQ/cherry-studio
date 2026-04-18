/**
 * Message utility stubs for Main process.
 *
 * TODO (Step 2 Phase C): The renderer versions use Redux store to look up
 * message blocks by ID. In Main process, messages come with inline data.blocks
 * (or data.parts after migration). These functions need to be rewritten to
 * work with the inline block structure instead of a normalized store.
 */

import type { Message } from '@types'

// These types are defined in @types/newMessage but we just need minimal stubs here
interface MainTextMessageBlock {
  type: 'main_text'
  content: string
  [key: string]: unknown
}

interface ThinkingMessageBlock {
  type: 'thinking'
  content: string
  [key: string]: unknown
}

interface ImageMessageBlock {
  type: 'image'
  [key: string]: unknown
}

interface FileMessageBlock {
  type: 'file'
  [key: string]: unknown
}

/** Stub: find main text blocks from a message */
export function findMainTextBlocks(_message: Message): MainTextMessageBlock[] {
  // TODO: implement for Main process (read from message.data.blocks)
  return []
}

/** Stub: find thinking blocks from a message */
export function findThinkingBlocks(_message: Message): ThinkingMessageBlock[] {
  // TODO: implement for Main process
  return []
}

/** Stub: find image blocks from a message */
export function findImageBlocks(_message: Message): ImageMessageBlock[] {
  // TODO: implement for Main process
  return []
}

/** Stub: find file blocks from a message */
export function findFileBlocks(_message: Message): FileMessageBlock[] {
  // TODO: implement for Main process
  return []
}

/** Stub: get main text content from a message */
export function getMainTextContent(_message: Message): string {
  // TODO: implement for Main process
  return ''
}
