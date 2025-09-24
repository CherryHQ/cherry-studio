import * as cmThemes from '@uiw/codemirror-themes-all'
import type { Extension } from '@uiw/react-codemirror'
import diff from 'fast-diff'

import type { CodeMirrorTheme, LanguageConfig } from './types'

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

// Default minimal language configuration for common languages
const _defaultLanguageConfig: LanguageConfig = {
  JavaScript: {
    type: 'programming',
    extensions: ['.js', '.mjs', '.cjs'],
    aliases: ['js', 'node']
  },
  TypeScript: {
    type: 'programming',
    extensions: ['.ts'],
    aliases: ['ts']
  },
  Python: {
    type: 'programming',
    extensions: ['.py'],
    aliases: ['python3', 'py']
  },
  Java: {
    type: 'programming',
    extensions: ['.java']
  },
  'C++': {
    type: 'programming',
    extensions: ['.cpp', '.cc', '.cxx'],
    aliases: ['cpp']
  },
  C: {
    type: 'programming',
    extensions: ['.c']
  },
  'C#': {
    type: 'programming',
    extensions: ['.cs'],
    aliases: ['csharp']
  },
  HTML: {
    type: 'markup',
    extensions: ['.html', '.htm']
  },
  CSS: {
    type: 'markup',
    extensions: ['.css']
  },
  JSON: {
    type: 'data',
    extensions: ['.json']
  },
  XML: {
    type: 'data',
    extensions: ['.xml']
  },
  YAML: {
    type: 'data',
    extensions: ['.yml', '.yaml']
  },
  SQL: {
    type: 'data',
    extensions: ['.sql']
  },
  Shell: {
    type: 'programming',
    extensions: ['.sh', '.bash'],
    aliases: ['bash', 'sh']
  },
  Go: {
    type: 'programming',
    extensions: ['.go'],
    aliases: ['golang']
  },
  Rust: {
    type: 'programming',
    extensions: ['.rs']
  },
  PHP: {
    type: 'programming',
    extensions: ['.php']
  },
  Ruby: {
    type: 'programming',
    extensions: ['.rb'],
    aliases: ['rb']
  },
  Swift: {
    type: 'programming',
    extensions: ['.swift']
  },
  Kotlin: {
    type: 'programming',
    extensions: ['.kt']
  },
  Dart: {
    type: 'programming',
    extensions: ['.dart']
  },
  R: {
    type: 'programming',
    extensions: ['.r']
  },
  MATLAB: {
    type: 'programming',
    extensions: ['.m']
  }
}

/**
 * Get the file extension of the language, by language name
 * - First, exact match
 * - Then, case-insensitive match
 * - Finally, match aliases
 * If there are multiple file extensions, only the first one will be returned
 * @param language language name
 * @param languageConfig optional language configuration, defaults to a minimal config
 * @returns file extension
 */
export function getExtensionByLanguage(language: string, languageConfig?: LanguageConfig): string {
  const languages = languageConfig || _defaultLanguageConfig
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

/**
 * Get the file extension of the language, for @uiw/codemirror-extensions-langs
 * - First, search for custom extensions
 * - Then, search for language configuration extensions
 * - Finally, assume the name is already an extension
 * @param language language name
 * @param languageConfig optional language configuration
 * @returns file extension (without `.` prefix)
 */
export async function getNormalizedExtension(language: string, languageConfig?: LanguageConfig) {
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

  // 2. Search for language configuration extensions
  const linguistExt = getExtensionByLanguage(lang, languageConfig)
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
    .filter((item) => typeof (cmThemes as any)[item] !== 'function')
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
