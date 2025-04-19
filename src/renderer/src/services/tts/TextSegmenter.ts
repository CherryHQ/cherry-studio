/**
 * 文本分段工具类
 * 用于将文本分割成句子或段落
 */
export class TextSegmenter {
  /**
   * 将文本分割成句子
   * @param text 要分割的文本
   * @returns 句子数组
   */
  public static splitIntoSentences(text: string): string[] {
    if (!text || text.trim() === '') {
      return []
    }

    // 以句子级别的标点符号为主要分隔点，保证流畅性
    // 句号、问号、感叹号、分号作为主要分隔点
    const punctuationRegex = /([.;:?!。；：？！]+)/g

    // 分割文本
    const parts = text.split(punctuationRegex)
    const segments: string[] = []

    // 将标点符号与前面的文本组合
    for (let i = 0; i < parts.length - 1; i += 2) {
      const content = parts[i]
      const punctuation = parts[i + 1] || ''
      if (content.trim() || punctuation.trim()) {
        segments.push((content.trim() + punctuation.trim()).trim())
      }
    }

    // 处理最后一个部分（如果有）
    if (parts.length % 2 !== 0 && parts[parts.length - 1].trim()) {
      segments.push(parts[parts.length - 1].trim())
    }

    // 进一步处理空格和换行符
    const result = segments
      .filter((segment) => segment.trim().length > 0) // 过滤空的片段
      .flatMap((segment) => {
        // 如果片段过长，按换行符进一步分割
        if (segment.length > 100) {
          const subParts = segment.split(/([\n\r]+)/)
          const subSegments: string[] = []

          for (let i = 0; i < subParts.length; i++) {
            const part = subParts[i].trim()
            if (part) {
              subSegments.push(part)
            }
          }

          return subSegments.length > 0 ? subSegments : [segment]
        }

        return [segment]
      })

    // 合并过短的片段，保证流畅性
    const mergedResult: string[] = []
    let currentSegment = ''

    for (const segment of result) {
      // 如果当前片段加上新片段仍然不超过100个字符，则合并
      if (currentSegment && currentSegment.length + segment.length < 100) {
        currentSegment += ' ' + segment
      } else {
        // 如果当前片段非空，则添加到结果中
        if (currentSegment) {
          mergedResult.push(currentSegment)
        }
        currentSegment = segment
      }
    }

    // 添加最后一个片段
    if (currentSegment) {
      mergedResult.push(currentSegment)
    }

    // 如果没有成功分割，则返回原文本作为一个句子
    return mergedResult.length > 0 ? mergedResult : [text]
  }
}
