/**
 * TTS文本过滤工具类
 * 用于过滤不适合TTS朗读的内容
 */
export class TTSTextFilter {
  /**
   * 过滤文本
   * @param text 原始文本
   * @param options 过滤选项
   * @returns 过滤后的文本
   */
  public static filterText(
    text: string,
    options: {
      filterThinkingProcess: boolean
      filterMarkdown: boolean
      filterCodeBlocks: boolean
      filterHtmlTags: boolean
      filterEmojis: boolean
      maxTextLength: number
    }
  ): string {
    if (!text) return ''

    let filteredText = text

    // 过滤思考过程
    if (options.filterThinkingProcess) {
      filteredText = this.filterThinkingProcess(filteredText)
    }

    // 过滤Markdown标记
    if (options.filterMarkdown) {
      filteredText = this.filterMarkdown(filteredText)
    }

    // 过滤代码块
    if (options.filterCodeBlocks) {
      filteredText = this.filterCodeBlocks(filteredText)
    }

    // 过滤HTML标签
    if (options.filterHtmlTags) {
      filteredText = this.filterHtmlTags(filteredText)
    }

    // 过滤表情符号
    if (options.filterEmojis) {
      filteredText = this.filterEmojis(filteredText)
    }

    // 限制文本长度
    if (options.maxTextLength > 0 && filteredText.length > options.maxTextLength) {
      filteredText = filteredText.substring(0, options.maxTextLength)
    }

    return filteredText.trim()
  }

  /**
   * 过滤思考过程
   * @param text 原始文本
   * @returns 过滤后的文本
   */
  private static filterThinkingProcess(text: string): string {
    // 过滤<think>标签内容
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '')

    // 过滤未闭合的<think>标签
    if (text.includes('<think>')) {
      const parts = text.split('<think>')
      text = parts[0]
    }

    // 过滤思考过程部分（###Thinking和###Response格式）
    const thinkingMatch = text.match(/###\s*Thinking[\s\S]*?(?=###\s*Response|$)/)
    if (thinkingMatch) {
      text = text.replace(thinkingMatch[0], '')
    }

    // 如果有Response部分，只保留Response部分
    const responseMatch = text.match(/###\s*Response\s*([\s\S]*?)(?=###|$)/)
    if (responseMatch) {
      text = responseMatch[1]
    }

    return text
  }

  /**
   * 过滤Markdown标记
   * @param text 原始文本
   * @returns 过滤后的文本
   */
  private static filterMarkdown(text: string): string {
    // 过滤标题标记
    text = text.replace(/#{1,6}\s+/g, '')

    // 过滤粗体和斜体标记
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
    text = text.replace(/(\*|_)(.*?)\1/g, '$2')

    // 过滤链接
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')

    // 过滤图片
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '')

    // 过滤引用
    text = text.replace(/^\s*>\s+/gm, '')

    // 过滤水平线
    text = text.replace(/^\s*[-*_]{3,}\s*$/gm, '')

    // 过滤列表标记
    text = text.replace(/^\s*[-*+]\s+/gm, '')
    text = text.replace(/^\s*\d+\.\s+/gm, '')

    return text
  }

  /**
   * 过滤代码块
   * @param text 原始文本
   * @returns 过滤后的文本
   */
  private static filterCodeBlocks(text: string): string {
    // 过滤围栏式代码块
    text = text.replace(/```[\s\S]*?```/g, '')

    // 过滤缩进式代码块
    text = text.replace(/(?:^|\n)( {4}|\t).*(?:\n|$)/g, '\n')

    // 过滤行内代码
    text = text.replace(/`([^`]+)`/g, '$1')

    return text
  }

  /**
   * 过滤HTML标签
   * @param text 原始文本
   * @returns 过滤后的文本
   */
  private static filterHtmlTags(text: string): string {
    // 过滤HTML标签
    text = text.replace(/<[^>]*>/g, '')

    // 过滤HTML实体
    text = text.replace(/&[a-zA-Z0-9#]+;/g, ' ')

    return text
  }

  /**
   * 过滤表情符号
   * @param text 原始文本
   * @returns 过滤后的文本
   */
  private static filterEmojis(text: string): string {
    // 过滤Unicode表情符号
    // 这个正则表达式匹配大多数常见的表情符号
    return text.replace(
      /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      ''
    )
  }
}
