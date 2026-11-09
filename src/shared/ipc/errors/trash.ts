import { IpcError } from './IpcError'

export const trashErrorCodes = {
  TRASH_TARGET_NOT_FOUND: 'TRASH_TARGET_NOT_FOUND',
  TRASH_TOPIC_BUSY: 'TRASH_TOPIC_BUSY',
  TRASH_TOPIC_PINNED: 'TRASH_TOPIC_PINNED'
} as const

export function isTrashTargetNotFoundError(error: unknown): error is IpcError {
  return error instanceof IpcError && error.code === trashErrorCodes.TRASH_TARGET_NOT_FOUND
}

export function isTrashTopicBusyError(error: unknown): error is IpcError {
  return error instanceof IpcError && error.code === trashErrorCodes.TRASH_TOPIC_BUSY
}

export function isTrashTopicPinnedError(error: unknown): error is IpcError {
  return error instanceof IpcError && error.code === trashErrorCodes.TRASH_TOPIC_PINNED
}
