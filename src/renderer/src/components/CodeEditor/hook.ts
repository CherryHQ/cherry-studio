import { linter } from '@codemirror/lint' // statically imported by @uiw/codemirror-extensions-basic-setup
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Extension } from '@uiw/react-codemirror'
import { useEffect, useState } from 'react'

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
