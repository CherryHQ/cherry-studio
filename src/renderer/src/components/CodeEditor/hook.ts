import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Extension } from '@uiw/react-codemirror'
import { useEffect, useState } from 'react'

let linterPromise: Promise<any> | null = null
function importLintPackage() {
  if (!linterPromise) {
    linterPromise = import('@codemirror/lint').then((mod) => mod.linter)
  }
  return linterPromise
}

// 语言对应的 linter 加载器
const linterLoaders: Record<string, () => Promise<any>> = {
  json: async () => {
    const [linter, jsonParseLinter] = await Promise.all([
      importLintPackage(),
      import('@codemirror/lang-json').then((mod) => mod.jsonParseLinter)
    ])
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
