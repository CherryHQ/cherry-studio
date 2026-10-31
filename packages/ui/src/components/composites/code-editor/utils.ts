import type * as CmThemes from '@uiw/codemirror-themes-all'
import type { Extension } from '@uiw/react-codemirror'
import diff from 'fast-diff'

import type { CodeMirrorTheme } from './types'

let cmThemesPromise: Promise<typeof CmThemes> | undefined

// Loaded on demand so the full themes-all package (and the @codemirror/*
// packages it drags in) stays out of every window's first-screen static graph.
function loadCmThemes(): Promise<typeof CmThemes> {
  cmThemesPromise ??= import('@uiw/codemirror-themes-all')
  return cmThemesPromise
}

/**
 * Computes code changes using fast-diff and converts them to CodeMirror changes.
 * Could handle all types of changes, though insertions are most common during streaming responses.
 * @param oldCode The old code content
 * @param newCode The new code content
 * @returns An array of changes for EditorView.dispatch
 */
export function prepareCodeChanges(oldCode: string, newCode: string) {
  const diffResult = diff(oldCode, newCode)

  const changes: { from: number; to: number; insert: string }[] = []
  let offset = 0

  // operation: 1=insert, -1=delete, 0=equal
  for (const [operation, text] of diffResult) {
    if (operation === 1) {
      changes.push({
        from: offset,
        to: offset,
        insert: text
      })
    } else if (operation === -1) {
      changes.push({
        from: offset,
        to: offset + text.length,
        insert: ''
      })
      offset += text.length
    } else {
      offset += text.length
    }
  }

  return changes
}

export { getExtensionByLanguage, getNormalizedExtension } from '../../../code-block'

/**
 * Get the list of CodeMirror theme names
 * - Include auto, light, dark
 * - Include all themes in @uiw/codemirror-themes-all
 *
 * A more robust approach might be to hardcode the theme list
 * @returns theme name list
 */
export async function getCmThemeNames(): Promise<string[]> {
  const cmThemes = await loadCmThemes()
  return ['auto', 'light', 'dark']
    .concat(Object.keys(cmThemes))
    .filter((item) => typeof (cmThemes as any)[item] !== 'function')
    .filter((item) => !/^(defaultSettings)/.test(item) && !/(Style)$/.test(item))
}

/**
 * Get the CodeMirror theme object by theme name
 * @param name theme name
 * @returns theme object
 */
export async function getCmThemeByName(name: string): Promise<CodeMirrorTheme> {
  // 1. Basic string theme
  if (name === 'light' || name === 'dark' || name === 'none') {
    return name
  }

  const cmThemes = await loadCmThemes()

  // 2. Search for the extension of the corresponding theme in @uiw/codemirror-themes-all
  const candidate = (cmThemes as Record<string, unknown>)[name]
  if (
    Object.prototype.hasOwnProperty.call(cmThemes, name) &&
    typeof candidate !== 'function' &&
    !/^defaultSettings/i.test(name) &&
    !/(Style)$/.test(name)
  ) {
    return candidate as Extension
  }

  // 3. If not found, fallback to light
  return 'light'
}

/** The Cherry default CodeMirror theme, loaded on demand like the other themes. */
export async function getCherryCmTheme(dark: boolean): Promise<Extension> {
  const { createCherryCmTheme } = await import('./cherry-theme')
  return createCherryCmTheme(dark)
}
