import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types/file'
import { isMac, isWin } from '@renderer/utils/platform'
import type { ComposerShortcut } from '@shared/data/preference/preferenceTypes'
import {
  formatShortcutDisplay,
  getShortcutBindingFromKeyboardEvent,
  isShortcutBinding,
  type KeyboardEventLike
} from '@shared/utils/shortcut'

const logger = loggerService.withContext('Utils:Input')

export const getTextFromDropEvent = async (e: React.DragEvent<HTMLDivElement>): Promise<string> => {
  return e.dataTransfer.getData('text')
}

export const getFilesFromDropEvent = async (e: React.DragEvent<HTMLDivElement>): Promise<FileMetadata[]> => {
  if (e.dataTransfer.files.length > 0) {
    // 使用新的API获取文件路径
    const filePromises = [...e.dataTransfer.files].map(async (file) => {
      try {
        // 使用新的webUtils.getPathForFile API获取文件路径
        const filePath = window.api.file.getPathForFile(file)
        if (filePath) {
          return window.api.file.get(filePath)
        }
        return null
      } catch (error) {
        logger.error('getFilesFromDropEvent - getPathForFile error:', error as Error)
        return null
      }
    })

    const results = await Promise.allSettled(filePromises)
    const list: FileMetadata[] = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        list.push(result.value)
      } else if (result.status === 'rejected') {
        logger.error('getFilesFromDropEvent:', result.reason)
      }
    }
    return list
  } else {
    return new Promise((resolve) => {
      let existCodefilesFormat = false
      for (const item of e.dataTransfer.items) {
        const { type } = item
        if (type === 'codefiles') {
          item.getAsString(async (filePathListString) => {
            const filePathList: string[] = JSON.parse(filePathListString)
            const filePathListPromises = filePathList.map((filePath) => window.api.file.get(filePath))
            resolve(
              await Promise.allSettled(filePathListPromises).then((results) =>
                results
                  .filter((result) => result.status === 'fulfilled')
                  .filter((result) => result.value !== null)
                  .map((result) => result.value!)
              )
            )
          })

          existCodefilesFormat = true
          break
        }
      }

      if (!existCodefilesFormat) {
        resolve([])
      }
    })
  }
}

const shortcutPlatform = isMac ? 'darwin' : isWin ? 'win32' : 'linux'

/** Stable identity of a binding — comparison, dedup, and select values all go through it. */
export const composerShortcutId = (shortcut: ComposerShortcut): string => shortcut.join('+')

/**
 * The Enter combinations the composer offers. `CommandOrControl` is Command on macOS and
 * Control elsewhere, so plain Control is only a separate combination on macOS.
 */
export const COMPOSER_SHORTCUTS: readonly ComposerShortcut[] = [
  ['Enter'],
  ['Shift', 'Enter'],
  ['CommandOrControl', 'Enter'],
  ['Alt', 'Enter'],
  ...(isMac ? [['Ctrl', 'Enter'] as ComposerShortcut] : [])
]

// v1 (and pre-2.0 v2) stored one of five fixed strings instead of a binding.
const LEGACY_COMPOSER_SHORTCUTS: Record<string, ComposerShortcut> = {
  Enter: ['Enter'],
  'Shift+Enter': ['Shift', 'Enter'],
  'Alt+Enter': ['Alt', 'Enter'],
  // Command+Enter was matched against the Meta key, i.e. the OS-reserved Win/Super key
  // off macOS, where it could never fire.
  'Command+Enter': ['CommandOrControl', 'Enter'],
  'Ctrl+Enter': isMac ? ['Ctrl', 'Enter'] : ['CommandOrControl', 'Enter']
}

const normalizeComposerShortcut = (stored: unknown): ComposerShortcut | null => {
  if (typeof stored === 'string') return LEGACY_COMPOSER_SHORTCUTS[stored] ?? null
  if (!isShortcutBinding(stored) || !stored.length) return null
  if (isMac) return stored
  // Off macOS the two tokens are the same physical key; keep one spelling so they compare equal.
  return stored.map((token) => (token === 'Ctrl' ? 'CommandOrControl' : token))
}

// Send / newline / steer must stay distinct: a stored value another role already took falls
// back to the first free combination.
const resolveComposerShortcut = (
  stored: unknown,
  taken: readonly ComposerShortcut[],
  preferred: ComposerShortcut
): ComposerShortcut => {
  const takenIds = taken.map(composerShortcutId)
  const shortcut = normalizeComposerShortcut(stored)
  if (shortcut && !takenIds.includes(composerShortcutId(shortcut))) return shortcut
  if (!takenIds.includes(composerShortcutId(preferred))) return preferred
  return COMPOSER_SHORTCUTS.find((candidate) => !takenIds.includes(composerShortcutId(candidate))) ?? preferred
}

export const resolveSendShortcut = (stored: unknown): ComposerShortcut => resolveComposerShortcut(stored, [], ['Enter'])

export const resolveNewlineShortcut = (stored: unknown, send: ComposerShortcut): ComposerShortcut =>
  resolveComposerShortcut(stored, [send], ['Shift', 'Enter'])

export const resolveSteerShortcut = (
  stored: unknown,
  send: ComposerShortcut,
  newline: ComposerShortcut
): ComposerShortcut => resolveComposerShortcut(stored, [send, newline], ['CommandOrControl', 'Enter'])

/** Whether the pressed key combination is `shortcut`. Callers own the IME-composition check. */
export const matchesComposerShortcut = (event: KeyboardEventLike, shortcut: ComposerShortcut): boolean =>
  composerShortcutId(getShortcutBindingFromKeyboardEvent(event, shortcutPlatform)) === composerShortcutId(shortcut)

export const getComposerShortcutLabel = (shortcut: ComposerShortcut): string => formatShortcutDisplay(shortcut, isMac)
