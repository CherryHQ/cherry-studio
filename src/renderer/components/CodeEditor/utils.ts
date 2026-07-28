import { codeLanguages as languages } from '@shared/utils/codeLanguages'
import diff from 'fast-diff'

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
 * Get the file extension of the language, by language name
 * - First, exact match
 * - Then, case-insensitive match
 * - Finally, match aliases
 * If there are multiple file extensions, only the first one will be returned
 * @param language language name
 * @returns file extension
 */
export function getExtensionByLanguage(language: string): string {
  const lowerLanguage = language.toLowerCase()

  // Exact match language name
  const directMatch = languages[language]
  if (directMatch?.extensions?.[0]) {
    return directMatch.extensions[0]
  }

  // Case-insensitive match language name
  for (const [langName, data] of Object.entries(languages)) {
    if (langName.toLowerCase() === lowerLanguage && data.extensions?.[0]) {
      return data.extensions[0]
    }
  }

  // Match aliases
  for (const [, data] of Object.entries(languages)) {
    if (data.aliases?.some((alias) => alias.toLowerCase() === lowerLanguage)) {
      return data.extensions?.[0] || `.${language}`
    }
  }

  // Fallback to language name
  return `.${language}`
}
