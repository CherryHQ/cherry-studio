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
  isQuickPanelVisible: boolean
  key: string
  text: string
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

  return text.trim().length === 0 || isAllSelected || isCursorAtHistoryBoundary
}
