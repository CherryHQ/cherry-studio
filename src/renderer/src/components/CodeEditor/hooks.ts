import { linter } from '@codemirror/lint' // statically imported by @uiw/codemirror-extensions-basic-setup
import { EditorView } from '@codemirror/view'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Extension, keymap } from '@uiw/react-codemirror'
import { useEffect, useMemo, useState } from 'react'

// 语言对应的 linter 加载器
const linterLoaders: Record<string, () => Promise<any>> = {
  json: async () => {
    const jsonParseLinter = await import('@codemirror/lang-json').then((mod) => mod.jsonParseLinter)
    return linter(jsonParseLinter())
  }
}

export const useLanguageExtensions = (language: string, lint?: boolean) => {
  const { languageMap } = useCodeStyle()
  const [extensions, setExtensions] = useState<Extension[]>([])

  // 加载语言
  useEffect(() => {
    let normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()

    // 如果语言名包含 `-`，转换为驼峰命名法
    if (normalizedLang.includes('-')) {
      normalizedLang = normalizedLang.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    }

    import('@uiw/codemirror-extensions-langs')
      .then(({ loadLanguage }) => {
        const extension = loadLanguage(normalizedLang as any)
        if (extension) {
          setExtensions((prev) => [...prev, extension])
        }
      })
      .catch((error) => {
        console.debug(`Failed to load language: ${normalizedLang}`, error)
      })
  }, [language, languageMap])

  useEffect(() => {
    if (!lint) return

    const loader = linterLoaders[language]
    if (loader) {
      loader()
        .then((extension) => {
          setExtensions((prev) => [...prev, extension])
        })
        .catch((error) => {
          console.error(`Failed to load linter for ${language}`, error)
        })
    }
  }, [language, lint])

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
