import { matchesComposerShortcut } from '@renderer/utils/input'
import type { ComposerHistoryRecall } from '@shared/data/preference/preferenceTypes'
import type { KeyboardEventLike } from '@shared/utils/shortcut'

export type InputHistoryDirection = 'up' | 'down'

interface NextInputHistoryIndexParams {
  currentIndex: number
  direction: InputHistoryDirection
  messagesLength: number
}

interface InputHistoryNavigationGuardParams {
  isAllSelected: boolean
  isComposing: boolean
  isCursorAtHistoryBoundary: boolean
  isHistoryShortcut: boolean
  isQuickPanelVisible: boolean
  key: string
  text: string
}

export function matchesHistoryRecallShortcut(event: KeyboardEventLike, policy: ComposerHistoryRecall): boolean {
  if (policy === 'off' || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false

  const directionKey = event.key === 'ArrowUp' ? 'Up' : 'Down'
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event
  return matchesComposerShortcut(
    { key, ctrlKey, metaKey, altKey, shiftKey },
    policy === 'ctrl_arrow' ? ['CommandOrControl', directionKey] : [directionKey]
  )
}

export function getNextInputHistoryIndex({
  currentIndex,
  direction,
  messagesLength
}: NextInputHistoryIndexParams): number {
  if (messagesLength === 0) {
    return currentIndex
  }

  if (direction === 'up') {
    return currentIndex < messagesLength - 1 ? currentIndex + 1 : currentIndex
  }

  if (currentIndex > 0) {
    return currentIndex - 1
  }

  if (currentIndex === 0) {
    return -1
  }

  return currentIndex
}

export function shouldHandleInputHistoryNavigation({
  isAllSelected,
  isComposing,
  isCursorAtHistoryBoundary,
  isHistoryShortcut,
  isQuickPanelVisible,
  key,
  text
}: InputHistoryNavigationGuardParams): boolean {
  if (isComposing || isQuickPanelVisible) {
    return false
  }

  if (key !== 'ArrowUp' && key !== 'ArrowDown') {
    return false
  }

  if (!isHistoryShortcut) return false

  return text.trim().length === 0 || isAllSelected || isCursorAtHistoryBoundary
}
