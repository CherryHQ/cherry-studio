import { escapeCode, loadCodeTheme, type SnapshotExecutor, type TokensResult } from '../../code-highlight'
import { createCodeBlockDocument } from './document'
import { getCodeBlockPalette } from './palette'

function tokenStyle(className: string | undefined, palette: Record<string, string>) {
  const style: Record<string, string> = { color: palette['--code-foreground'] }
  for (const name of className?.split(' ') ?? []) {
    const role = name.replace(/^code-syntax-/, '')
    if (!palette[`--code-syntax-${role}`]) continue
    style.color = palette[`--code-syntax-${role}`]
    style['font-style'] = palette[`--code-syntax-${role}-style`]
    style['font-weight'] = palette[`--code-syntax-${role}-weight`]
  }
  return style
}

export function createCodeBlockSnapshotExecutor(): SnapshotExecutor {
  const cache = new Map<string, { size: number; result: TokensResult }>()
  const pending = new Map<string, Promise<TokensResult>>()
  let retained = 0
  return (request) => {
    const key = JSON.stringify(request)
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return Promise.resolve(cached.result)
    }
    const running = pending.get(key)
    if (running) return running
    const task = Promise.all([
      loadCodeTheme(request.themes[0], request.foreground),
      loadCodeTheme(request.themes[1], request.foreground)
    ])
      .then(async ([light, dark]) => {
        const document = await createCodeBlockDocument(request.code, request.language)
        try {
          const result = await document.read({ start: 0, end: request.code.split('\n').length })
          const palettes = [getCodeBlockPalette(light), getCodeBlockPalette(dark)]
          const snapshot: TokensResult = {
            fg: palettes[0]['--code-foreground'],
            bg: palettes[0]['--code-background'],
            rootStyle: `--shiki-dark:${palettes[1]['--code-foreground']};--shiki-dark-bg:${palettes[1]['--code-background']}`,
            tokens: result.lines.map((line) =>
              line.map(({ className, ...token }) => {
                const style = tokenStyle(className, palettes[0])
                const darkStyle = tokenStyle(className, palettes[1])
                return {
                  ...token,
                  color: style.color,
                  htmlStyle: {
                    ...style,
                    '--shiki-dark': darkStyle.color,
                    '--shiki-dark-font-style': darkStyle['font-style'] ?? 'normal',
                    '--shiki-dark-font-weight': darkStyle['font-weight'] ?? 'normal'
                  }
                }
              })
            )
          }
          if (request.code.length <= 1_048_576) {
            cache.set(key, { size: request.code.length, result: snapshot })
            retained += request.code.length
            while (cache.size > 24 || retained > 1_048_576) {
              const oldest = cache.keys().next().value!
              retained -= cache.get(oldest)!.size
              cache.delete(oldest)
            }
          }
          return snapshot
        } finally {
          document.dispose()
        }
      })
      .finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
}

const execute = createCodeBlockSnapshotExecutor()
export async function codeBlockToHtml(code: string, language: string, theme: string) {
  const result = await execute({ code, language, themes: [theme, theme] })
  const html = result.tokens
    .map((line) =>
      line
        .map((token) => {
          const style = Object.entries(token.htmlStyle ?? {})
            .filter(([name]) => !name.startsWith('--'))
            .map(([name, value]) => `${name}:${value}`)
            .join(';')
          return `<span style="${escapeCode(style)}">${escapeCode(token.content).replaceAll('\r', '&#13;')}</span>`
        })
        .join('')
    )
    .join('\n')
  return `<pre class="shiki highlights" style="color:${escapeCode(result.fg ?? '')};background-color:${escapeCode(result.bg ?? '')}"><code>${html}</code></pre>`
}
