import { linter } from '@codemirror/lint' // statically imported by @uiw/codemirror-extensions-basic-setup
import { EditorView } from '@codemirror/view'
import { loggerService } from '@logger'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Extension, keymap } from '@uiw/react-codemirror'
import { useEffect, useMemo, useState } from 'react'

const logger = loggerService.withContext('CodeEditorHooks')

// 语言对应的 linter 加载器
const linterLoaders: Record<string, () => Promise<any>> = {
  json: async () => {
    const jsonParseLinter = await import('@codemirror/lang-json').then((mod) => mod.jsonParseLinter)
    return linter(jsonParseLinter())
  }
}

/**
 * 特殊语言加载器
 */
const specialLanguageLoaders: Record<string, () => Promise<Extension>> = {
  dot: async () => {
    const mod = await import('@viz-js/lang-dot')
    return mod.dot()
  }
}

/**
 * 加载语言扩展
 */
async function loadLanguageExtension(language: string, languageMap: Record<string, string>): Promise<Extension | null> {
  let normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()

  // 如果语言名包含 `-`，转换为驼峰命名法
  if (normalizedLang.includes('-')) {
    normalizedLang = normalizedLang.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
  }

  // 尝试加载特殊语言
  const specialLoader = specialLanguageLoaders[normalizedLang]
  if (specialLoader) {
    try {
      return await specialLoader()
    } catch (error) {
      logger.debug(`Failed to load language ${normalizedLang}`, error as Error)
      return null
    }
  }

  // 回退到 uiw/codemirror 包含的语言
  try {
    const { loadLanguage } = await import('@uiw/codemirror-extensions-langs')
    const extension = loadLanguage(normalizedLang as any)
    return extension || null
  } catch (error) {
    logger.debug(`Failed to load language ${normalizedLang}`, error as Error)
    return null
  }
}

/**
 * 加载 linter 扩展
 */
async function loadLinterExtension(language: string): Promise<Extension | null> {
  const loader = linterLoaders[language]
  if (!loader) return null

  try {
    return await loader()
  } catch (error) {
    logger.debug(`Failed to load linter for ${language}`, error as Error)
    return null
  }
}

/**
 * 加载语言相关扩展
 */
export const useLanguageExtensions = (language: string, lint?: boolean) => {
  const { languageMap } = useCodeStyle()
  const [extensions, setExtensions] = useState<Extension[]>([])

  useEffect(() => {
    let cancelled = false

    const loadAllExtensions = async () => {
      try {
        // 加载所有扩展
        const [languageResult, linterResult] = await Promise.allSettled([
          loadLanguageExtension(language, languageMap),
          lint ? loadLinterExtension(language) : Promise.resolve(null)
        ])

        if (cancelled) return

        const results: Extension[] = []

        // 语言扩展
        if (languageResult.status === 'fulfilled' && languageResult.value) {
          results.push(languageResult.value)
        }

        // linter 扩展
        if (linterResult.status === 'fulfilled' && linterResult.value) {
          results.push(linterResult.value)
        }

        setExtensions(results)
      } catch (error) {
        if (!cancelled) {
          logger.debug('Failed to load language extensions:', error as Error)
          setExtensions([])
        }
      }
    }

    loadAllExtensions()

    return () => {
      cancelled = true
    }
  }, [language, lint, languageMap])

  return extensions
}

interface UseSaveKeymapProps {
  onSave?: (content: string) => void
  enabled?: boolean
}

/**
 * CodeMirror 扩展，用于处理保存快捷键 (Cmd/Ctrl + S)
 * @param onSave 保存时触发的回调函数
 * @param enabled 是否启用此快捷键
 * @returns 扩展或空数组
 */
export function useSaveKeymap({ onSave, enabled = true }: UseSaveKeymapProps) {
  return useMemo(() => {
    if (!enabled || !onSave) {
      return []
    }

    return keymap.of([
      {
        key: 'Mod-s',
        run: (view: EditorView) => {
          onSave(view.state.doc.toString())
          return true
        },
        preventDefault: true
      }
    ])
  }, [onSave, enabled])
}

interface UseBlurHandlerProps {
  onBlur?: (content: string) => void
}

/**
 * CodeMirror 扩展，用于处理编辑器的 blur 事件
 * @param onBlur blur 事件触发时的回调函数
 * @returns 扩展或空数组
 */
export function useBlurHandler({ onBlur }: UseBlurHandlerProps) {
  return useMemo(() => {
    if (!onBlur) {
      return []
    }
    return EditorView.domEventHandlers({
      blur: (_event, view) => {
        onBlur(view.state.doc.toString())
      }
    })
  }, [onBlur])
}
