import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

export async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: ['javascript', 'typescript', 'python', 'java', 'markdown', 'json'],
      themes: ['one-light', 'material-theme-darker']
    })
  }

  return await highlighterPromise
}

export async function loadLanguageIfNeeded(highlighter: Highlighter, language: string) {
  if (!highlighter.getLoadedLanguages().includes(language)) {
    const languageImportFn = bundledLanguages[language]
    if (languageImportFn) {
      await highlighter.loadLanguage(await languageImportFn())
    }
  }
}

export async function loadThemeIfNeeded(highlighter: Highlighter, theme: string) {
  if (!highlighter.getLoadedThemes().includes(theme)) {
    const themeImportFn = bundledThemes[theme]
    if (themeImportFn) {
      await highlighter.loadTheme(await themeImportFn())
    }
  }
}
