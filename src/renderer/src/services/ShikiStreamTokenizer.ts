import type { CodeToTokensOptions, GrammarState, HighlighterCore, HighlighterGeneric, ThemedToken } from 'shiki/core'

export type ShikiStreamTokenizerOptions = CodeToTokensOptions<string, string> & {
  highlighter: HighlighterCore | HighlighterGeneric<any, any>
}

export interface ShikiStreamTokenizerEnqueueResult {
  /**
   * 要撤回的行数
   */
  recall: number
  /**
   * 稳定行
   */
  stable: ThemedToken[][]
  /**
   * 不稳定行
   */
  unstable: ThemedToken[][]
}

/**
 * 修改自 shiki-stream 的 tokenizer。
 *
 * 和 shiki-stream 实现的不同：
 * - tokenizer 会拆分代码块为两个 subtrunk，第一个 subtrunk 可以包含多行。
 * - 这个实现可以避免 chunk 过大时引入额外开销。
 */
export class ShikiStreamTokenizer {
  public readonly options: ShikiStreamTokenizerOptions

  // public linesStable: ThemedToken[][] = []
  public linesUnstable: ThemedToken[][] = []

  public lastUnstableCodeChunk: string = ''
  public lastStableGrammarState: GrammarState | undefined

  constructor(options: ShikiStreamTokenizerOptions) {
    this.options = options
  }

  /**
   * 使用 tokenizer 处理一个代码片段。
   */
  async enqueue(chunk: string): Promise<ShikiStreamTokenizerEnqueueResult> {
    const subTrunks = splitToSubTrunks(this.lastUnstableCodeChunk + chunk)

    const stable: ThemedToken[][] = []
    const unstable: ThemedToken[][] = []
    const recall = this.linesUnstable.length

    subTrunks.forEach((subTrunck, i) => {
      const isLastChunk = i === subTrunks.length - 1

      const result = this.options.highlighter.codeToTokens(subTrunck, {
        ...this.options,
        grammarState: this.lastStableGrammarState
      })

      if (!isLastChunk) {
        this.lastStableGrammarState = result.grammarState

        result.tokens.forEach((tokenLine) => {
          stable.push(tokenLine)
        })
      } else {
        unstable.push(result.tokens[0])
        this.lastUnstableCodeChunk = subTrunck
      }
    })

    // this.linesStable.push(...stable)
    this.linesUnstable = unstable

    return {
      recall,
      stable,
      unstable
    }
  }

  close(): { stable: ThemedToken[][] } {
    const stable = this.linesUnstable
    this.linesUnstable = []
    this.lastUnstableCodeChunk = ''
    this.lastStableGrammarState = undefined
    return {
      stable
    }
  }

  clear(): void {
    // this.linesStable = []
    this.linesUnstable = []
    this.lastUnstableCodeChunk = ''
    this.lastStableGrammarState = undefined
  }
}

/**
 * 将代码字符串 chunk 按行分割为至多两个 subtrunks
 * @param chunk 代码字符串
 * @returns subtrunks 数组
 */
export function splitToSubTrunks(chunk: string) {
  const lastNewlineIndex = chunk.lastIndexOf('\n')
  if (lastNewlineIndex === -1) {
    return [chunk]
  }
  return [chunk.substring(0, lastNewlineIndex), chunk.substring(lastNewlineIndex + 1)]
}
