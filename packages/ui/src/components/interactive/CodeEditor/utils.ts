import * as cmThemes from '@uiw/codemirror-themes-all'
import { Extension } from '@uiw/react-codemirror'
import diff from 'fast-diff'

import { getExtensionByLanguage } from '../../../utils/codeLanguage'
import { CodeMirrorTheme } from './types'

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

// Custom language file extension mapping
// key: language name in lowercase
// value: file extension
const _customLanguageExtensions: Record<string, string> = {
  svg: 'xml',
  vab: 'vb',
  graphviz: 'dot'
}

/**
 * Get the file extension of the language, for @uiw/codemirror-extensions-langs
 * - First, search for custom extensions
 * - Then, search for github linguist extensions
 * - Finally, assume the name is already an extension
 * @param language language name
 * @returns file extension (without `.` prefix)
 */
export async function getNormalizedExtension(language: string) {
  let lang = language

  // If the language name looks like an extension, remove the dot
  if (language.startsWith('.') && language.length > 1) {
    lang = language.slice(1)
  }

  const lowerLanguage = lang.toLowerCase()

  // 1. Search for custom extensions
  const customExt = _customLanguageExtensions[lowerLanguage]
  if (customExt) {
    return customExt
  }

  // 2. Search for github linguist extensions
  const linguistExt = getExtensionByLanguage(lang)
  if (linguistExt) {
    return linguistExt.slice(1)
  }

  // Fallback to language name
  return lang
}

/**
 * Get the list of CodeMirror theme names
 * - Include auto, light, dark
 * - Include all themes in @uiw/codemirror-themes-all
 *
 * A more robust approach might be to hardcode the theme list
 * @returns theme name list
 */
export function getCmThemeNames(): string[] {
  return ['auto', 'light', 'dark']
    .concat(Object.keys(cmThemes))
    .filter((item) => typeof cmThemes[item as keyof typeof cmThemes] !== 'function')
    .filter((item) => !/^(defaultSettings)/.test(item as string) && !/(Style)$/.test(item as string))
}

/**
 * Get the CodeMirror theme object by theme name
 * @param name theme name
 * @returns theme object
 */
export function getCmThemeByName(name: string): CodeMirrorTheme {
  // 1. Search for the extension of the corresponding theme in @uiw/codemirror-themes-all
  const candidate = (cmThemes as Record<string, unknown>)[name]
  if (
    Object.prototype.hasOwnProperty.call(cmThemes, name) &&
    typeof candidate !== 'function' &&
    !/^defaultSettings/i.test(name) &&
    !/(Style)$/.test(name)
  ) {
    return candidate as Extension
  }

  // 2. Basic string theme
  if (name === 'light' || name === 'dark' || name === 'none') {
    return name
  }

  // 3. If not found, fallback to light
  return 'light'
}
