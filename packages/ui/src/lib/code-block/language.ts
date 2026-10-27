import type { Language, LanguageSupport } from '@codemirror/language'

import { CODE_LANGUAGES, normalizeCodeLanguage } from '../../code-highlight'

/** Language data structure for file extension mapping */
export interface LanguageData {
  type: string
  aliases?: string[]
  extensions?: string[]
}

/** Language configuration mapping language names to their data */
export type LanguageConfig = Record<string, LanguageData>

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
  return normalizeExtension(language, languageConfig)
}

function normalizeExtension(language: string, languageConfig?: LanguageConfig) {
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
  // @uiw/codemirror-extensions-langs keys are all lowercase, so a language name
  // that falls through as its own extension (Markdown, TSX, TOML...) must be lowered.
  const linguistExt = getExtensionByLanguage(lang, languageConfig)
  if (linguistExt) {
    return linguistExt.slice(1).toLowerCase()
  }

  // Fallback to language name
  return lowerLanguage
}

type Support = Language | LanguageSupport
const languages = new Map<string, Promise<Support | null>>()

export function loadCodeBlockLanguage(language: string, config?: LanguageConfig): Promise<Support | null> {
  const extension = normalizeExtension(language, config)
  let pending = languages.get(extension)
  if (!pending) {
    pending = (async () => {
      if (extension === 'dot') return (await import('@viz-js/lang-dot')).dot()
      if (extension === 'mmd' || extension === 'mermaid') return (await import('codemirror-lang-mermaid')).mermaid()
      const { loadLanguage } = await import('@uiw/codemirror-extensions-langs')
      const canonical = normalizeCodeLanguage(extension)
      const candidates = [
        extension,
        normalizeExtension(canonical),
        ...(CODE_LANGUAGES[canonical as keyof typeof CODE_LANGUAGES] ?? [])
      ]
      for (const candidate of candidates) {
        const support = loadLanguage(candidate as Parameters<typeof loadLanguage>[0])
        if (support) return support
      }
      return null
    })()
    languages.set(extension, pending)
    void pending.catch(() => languages.delete(extension))
  }
  return pending
}

export function getCodeBlockParser(support: Support) {
  return ('language' in support ? support.language : support).parser
}
