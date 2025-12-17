import { getPotentialStartIndex } from './getPotentialIndex'

export interface TagConfig {
  openingTag: string
  closingTag: string
  separator?: string
}

export interface TagExtractionState {
  textBuffer: string
  isInsideTag: boolean
  isFirstTag: boolean
  isFirstText: boolean
  afterSwitch: boolean
  accumulatedTagContent: string
  hasTagContent: boolean
}

export interface TagExtractionResult {
  content: string
  isTagContent: boolean
  complete: boolean
  tagContentExtracted?: string
}

/**
 * 通用标签提取处理器
 * 可以处理各种形式的标签对，如 <think>...</think>, <tool_use>...</tool_use> 等
 */
export class TagExtractor {
  private config: TagConfig
  private state: TagExtractionState

  constructor(config: TagConfig) {
    this.config = config
    this.state = {
      textBuffer: '',
      isInsideTag: false,
      isFirstTag: true,
      isFirstText: true,
      afterSwitch: false,
      accumulatedTagContent: '',
      hasTagContent: false
    }
  }

  /**
   * 处理文本块，返回处理结果
   */
  processText(newText: string): TagExtractionResult[] {
    this.state.textBuffer += newText
    const results: TagExtractionResult[] = []

    // 处理标签提取逻辑
    while (true) {
      const nextTag = this.state.isInsideTag ? this.config.closingTag : this.config.openingTag
      const startIndex = getPotentialStartIndex(this.state.textBuffer, nextTag)

      if (startIndex == null) {
        const content = this.state.textBuffer
        if (content.length > 0) {
          results.push({
            content: this.addPrefix(content),
            isTagContent: this.state.isInsideTag,
            complete: false
          })

          if (this.state.isInsideTag) {
            this.state.accumulatedTagContent += this.addPrefix(content)
            this.state.hasTagContent = true
          }
        }
        this.state.textBuffer = ''
        break
      }

      // 处理标签前的内容
      const contentBeforeTag = this.state.textBuffer.slice(0, startIndex)
      if (contentBeforeTag.length > 0) {
        results.push({
          content: this.addPrefix(contentBeforeTag),
          isTagContent: this.state.isInsideTag,
          complete: false
        })

        if (this.state.isInsideTag) {
          this.state.accumulatedTagContent += this.addPrefix(contentBeforeTag)
          this.state.hasTagContent = true
        }
      }

      const foundFullMatch = startIndex + nextTag.length <= this.state.textBuffer.length

      if (foundFullMatch) {
        // 如果找到完整的标签
        this.state.textBuffer = this.state.textBuffer.slice(startIndex + nextTag.length)

        // 如果刚刚结束一个标签内容，生成完整的标签内容结果
        if (this.state.isInsideTag && this.state.hasTagContent) {
          results.push({
            content: '',
            isTagContent: false,
            complete: true,
            tagContentExtracted: this.state.accumulatedTagContent
          })
          this.state.accumulatedTagContent = ''
          this.state.hasTagContent = false
        }

        this.state.isInsideTag = !this.state.isInsideTag
        this.state.afterSwitch = true

        if (this.state.isInsideTag) {
          this.state.isFirstTag = false
        } else {
          this.state.isFirstText = false
        }
      } else {
        this.state.textBuffer = this.state.textBuffer.slice(startIndex)
        break
      }
    }

    return results
  }

  /**
   * 完成处理，返回任何剩余的标签内容
   */
  finalize(): TagExtractionResult | null {
    if (this.state.hasTagContent && this.state.accumulatedTagContent) {
      const result = {
        content: '',
        isTagContent: false,
        complete: true,
        tagContentExtracted: this.state.accumulatedTagContent
      }
      this.state.accumulatedTagContent = ''
      this.state.hasTagContent = false
      return result
    }
    return null
  }

  private addPrefix(text: string): string {
    const needsPrefix =
      this.state.afterSwitch && (this.state.isInsideTag ? !this.state.isFirstTag : !this.state.isFirstText)

    const prefix = needsPrefix && this.config.separator ? this.config.separator : ''
    this.state.afterSwitch = false
    return prefix + text
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state = {
      textBuffer: '',
      isInsideTag: false,
      isFirstTag: true,
      isFirstText: true,
      afterSwitch: false,
      accumulatedTagContent: '',
      hasTagContent: false
    }
  }
}
