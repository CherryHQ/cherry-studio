/// <reference lib="webworker" />

import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from 'shiki'

let highlighter: Highlighter | null = null

// 初始化高亮器
async function initHighlighter(themes: string[], languages: string[]) {
  highlighter = await createHighlighter({
    langs: languages,
    themes: themes
  })
  return { loaded: true }
}

// 加载额外语言
async function loadLanguage(language: string) {
  if (highlighter && !highlighter.getLoadedLanguages().includes(language)) {
    const languageImportFn = bundledLanguages[language]
    if (languageImportFn) {
      await highlighter.loadLanguage(await languageImportFn())
      return { success: true }
    }
  }
  return { success: false }
}

// 加载额外主题
async function loadTheme(theme: string) {
  if (highlighter && !highlighter.getLoadedThemes().includes(theme)) {
    const themeImportFn = bundledThemes[theme]
    if (themeImportFn) {
      await highlighter.loadTheme(await themeImportFn())
      return { success: true }
    }
  }
  return { success: false }
}

// 处理代码高亮
async function highlightCode(code: string, language: string, theme: string) {
  if (!code) return { html: '' }

  const languageMap: Record<string, string> = { vab: 'vb' }
  const mappedLanguage = languageMap[language] || language

  try {
    // 确保语言和主题已加载
    await loadLanguage(mappedLanguage)
    await loadTheme(theme)

    // 生成高亮HTML
    if (!highlighter) throw new Error('Shiki Highlighter is not initialized')

    const html = highlighter.codeToHtml(code, {
      lang: mappedLanguage,
      theme: theme
    })

    return { html, success: true }
  } catch (error: any) {
    const escapedCode = code?.replace(/[<>]/g, (char) => ({ '<': '&lt;', '>': '&gt;' })[char]!)
    return {
      html: `<pre style="padding: 10px"><code>${escapedCode}</code></pre>`,
      success: false,
      error: error.message || String(error)
    }
  }
}

// 定义 worker 上下文类型
declare const self: DedicatedWorkerGlobalScope

// 监听消息
self.onmessage = async (e) => {
  const { type, payload } = e.data
  let initResult
  let code, language, theme, cacheKey, result

  switch (type) {
    case 'init':
      initResult = await initHighlighter(payload.themes, payload.languages)
      self.postMessage({ type: 'init', result: initResult })
      break

    case 'highlight':
      code = payload.code
      language = payload.language
      theme = payload.theme
      cacheKey = payload.cacheKey
      result = await highlightCode(code, language, theme)
      self.postMessage({
        type: 'highlight',
        result,
        cacheKey // 返回相同的缓存键便于识别
      })
      break

    default:
      self.postMessage({
        type: 'error',
        error: 'Unknown command'
      })
  }
}
