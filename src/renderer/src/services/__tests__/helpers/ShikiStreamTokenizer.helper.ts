import { ShikiStreamTokenizer } from '@renderer/services/ShikiStreamTokenizer'
import { getTokenStyleObject, HighlighterCore, stringifyTokenStyle, type ThemedToken } from 'shiki/core'

/**
 * 使用 ShikiStreamTokenizer 获取流式高亮代码
 * @param chunks 代码块数组，模拟流式响应
 * @param tokenizer tokenizer 实例
 * @returns 高亮后的 HTML
 */
export async function highlightCode(chunks: string[], tokenizer: ShikiStreamTokenizer): Promise<string> {
  let tokenLines: ThemedToken[][] = []

  for (const chunk of chunks) {
    const result = await tokenizer.enqueue(chunk)

    // 根据 recall 值移除可能需要重新处理的行
    if (result.recall > 0 && tokenLines.length > 0) {
      tokenLines = tokenLines.slice(0, Math.max(0, tokenLines.length - result.recall))
    }

    // 添加稳定的行和不稳定的行
    tokenLines = [...tokenLines, ...result.stable, ...result.unstable]
  }

  // 这里就不获取返回值了，因为最后一行应该已经处理完了
  tokenizer.close()

  return tokenLinesToHtml(tokenLines)
}

/**
 * 使用 shiki codeToTokens 获取正确的高亮代码
 * @param code 代码
 * @param highlighter 高亮器
 * @returns 预期的 html
 */
export function getExpectedHighlightedCode(code: string, highlighter: HighlighterCore | null) {
  const expected = highlighter?.codeToTokens(code, {
    lang: 'typescript',
    theme: 'one-light'
  })

  return tokenLinesToHtml(expected?.tokens ?? [])
}

/**
 * 将单个 token 转换为 html
 * @param token
 * @returns span
 */
export function tokenToHtml(token: ThemedToken): string {
  return `<span style="${stringifyTokenStyle(token.htmlStyle || getTokenStyleObject(token))}">${escapeHtml(token.content)}</span>`
}

/**
 * 将单行 token 转换为 html
 * @param tokenLine token 数组
 * @returns span with className line
 */
export function tokenLineToHtml(tokenLine: ThemedToken[]): string {
  return `<span className="line">${tokenLine.map(tokenToHtml).join('')}</span>`
}

/**
 * 将多行 token 转换为 html
 * @param tokenLines token 数组
 * @returns spans with className line
 */
export function tokenLinesToHtml(tokenLines: ThemedToken[][]): string {
  return tokenLines.map(tokenLineToHtml).join('\n')
}

/**
 * 转义 html
 * @param html html
 * @returns 转义后的 html
 */
export function escapeHtml(html: string): string {
  return html.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 将字符串按指定长度 n 切分为字符串数组
 * @param code 原始字符串
 * @param n 每个元素的长度
 * @returns 切分后的字符串数组
 */
export function generateEqualLengthChunks(code: string, n: number): string[] {
  if (n <= 0) throw new Error('n must be greater than 0')
  const result: string[] = []
  for (let i = 0; i < code.length; i += n) {
    result.push(code.slice(i, i + n))
  }
  return result
}
