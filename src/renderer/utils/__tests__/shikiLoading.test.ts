import type { HighlighterGeneric } from 'shiki/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const shikiMocks = vi.hoisted(() => ({
  bundledLanguages: {} as Record<string, ReturnType<typeof vi.fn>>,
  bundledThemes: {} as Record<string, ReturnType<typeof vi.fn>>,
  bundledThemesInfo: [],
  createHighlighter: vi.fn()
}))

vi.mock('shiki', () => shikiMocks)
vi.mock('markdown-it', () => ({
  default: vi.fn(() => ({
    render: vi.fn(() => ''),
    use: vi.fn()
  }))
}))
vi.mock('@shikijs/markdown-it/core', () => ({ fromHighlighter: vi.fn(() => vi.fn()) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function createHighlighter() {
  const loadedLanguages = new Set(['text'])
  const loadedThemes = new Set(['one-light'])
  const highlighter = {
    getLoadedLanguages: vi.fn(() => [...loadedLanguages]),
    getLoadedThemes: vi.fn(() => [...loadedThemes]),
    getTheme: vi.fn(() => ({ type: 'light' })),
    loadLanguage: vi.fn(async (language: string | { id: string }) => {
      loadedLanguages.add(typeof language === 'string' ? language : language.id)
    }),
    loadTheme: vi.fn(async (theme: string | { name: string }) => {
      loadedThemes.add(typeof theme === 'string' ? theme : theme.name)
    })
  }
  return highlighter as unknown as HighlighterGeneric<any, any>
}

describe('Shiki asset loading', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(shikiMocks.bundledLanguages)) delete shikiMocks.bundledLanguages[key]
    for (const key of Object.keys(shikiMocks.bundledThemes)) delete shikiMocks.bundledThemes[key]
    shikiMocks.bundledThemes['one-light'] = vi.fn(async () => ({ name: 'one-light' }))
  })

  it('starts independent language and theme loads in parallel', async () => {
    const language = deferred<{ id: string }>()
    const theme = deferred<{ name: string }>()
    shikiMocks.bundledLanguages.ruby = vi.fn(() => language.promise)
    shikiMocks.bundledThemes.nord = vi.fn(() => theme.promise)
    const highlighter = createHighlighter()
    const { loadLanguageAndThemeIfNeeded } = await import('../shiki')

    const loading = loadLanguageAndThemeIfNeeded(highlighter, 'ruby', 'nord')

    await vi.waitFor(() => {
      expect(shikiMocks.bundledLanguages.ruby).toHaveBeenCalledOnce()
      expect(shikiMocks.bundledThemes.nord).toHaveBeenCalledOnce()
    })
    language.resolve({ id: 'ruby' })
    theme.resolve({ name: 'nord' })

    await expect(loading).resolves.toEqual({ loadedLanguage: 'ruby', loadedTheme: 'nord' })
  })

  it('loads each fenced language once and starts unique languages in parallel', async () => {
    const ruby = deferred<{ id: string }>()
    const go = deferred<{ id: string }>()
    shikiMocks.bundledLanguages.ruby = vi.fn(() => ruby.promise)
    shikiMocks.bundledLanguages.go = vi.fn(() => go.promise)
    const highlighter = createHighlighter()
    shikiMocks.createHighlighter.mockResolvedValue(highlighter)
    const { getMarkdownIt } = await import('../shiki')

    const loading = getMarkdownIt('one-light', '```ruby\nputs 1\n```\n```go\nfmt.Println()\n```\n```ruby\nputs 2\n```')

    await vi.waitFor(() => {
      expect(shikiMocks.bundledLanguages.ruby).toHaveBeenCalledOnce()
      expect(shikiMocks.bundledLanguages.go).toHaveBeenCalledOnce()
    })
    ruby.resolve({ id: 'ruby' })
    go.resolve({ id: 'go' })

    await expect(loading).resolves.toBeDefined()
  })

  it('shares a same-key in-flight language load', async () => {
    const ruby = deferred<{ id: string }>()
    shikiMocks.bundledLanguages.ruby = vi.fn(() => ruby.promise)
    const highlighter = createHighlighter()
    const { loadLanguageIfNeeded } = await import('../shiki')

    const first = loadLanguageIfNeeded(highlighter, 'ruby')
    const second = loadLanguageIfNeeded(highlighter, 'ruby')

    await vi.waitFor(() => expect(shikiMocks.bundledLanguages.ruby).toHaveBeenCalledOnce())
    ruby.resolve({ id: 'ruby' })
    await expect(Promise.all([first, second])).resolves.toEqual(['ruby', 'ruby'])
  })

  it.each([
    ['language', 'ruby'],
    ['theme', 'nord']
  ] as const)('retries a %s load after its fallback rejects', async (kind, key) => {
    const highlighter = createHighlighter()
    const loadLanguage = vi.mocked(highlighter.loadLanguage)
    const fallbackError = new Error('fallback failed')

    if (kind === 'language') {
      shikiMocks.bundledLanguages[key] = vi
        .fn()
        .mockRejectedValueOnce(new Error('language failed'))
        .mockResolvedValueOnce({ id: key })
      loadLanguage.mockRejectedValueOnce(fallbackError)
    } else {
      shikiMocks.bundledThemes[key] = vi
        .fn()
        .mockRejectedValueOnce(new Error('theme failed'))
        .mockResolvedValueOnce({ name: key })
      shikiMocks.bundledThemes['one-light'].mockRejectedValueOnce(fallbackError)
    }

    const { loadLanguageIfNeeded, loadThemeIfNeeded } = await import('../shiki')
    const load = kind === 'language' ? loadLanguageIfNeeded : loadThemeIfNeeded

    await expect(load(highlighter, key)).rejects.toBe(fallbackError)
    await expect(load(highlighter, key)).resolves.toBe(key)
    expect(
      kind === 'language' ? shikiMocks.bundledLanguages[key] : shikiMocks.bundledThemes[key]
    ).toHaveBeenCalledTimes(2)
  })
})
