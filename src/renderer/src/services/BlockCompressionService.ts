import { loggerService } from '@logger'
import store from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import {
  CodeMessageBlock,
  MainTextMessageBlock,
  MessageBlock,
  MessageBlockStatus,
  ThinkingMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'

const logger = loggerService.withContext('BlockCompressionService')

// 类型守卫，检查块是否有 content 属性
function hasContent(
  block: MessageBlock
): block is MainTextMessageBlock | ThinkingMessageBlock | TranslationMessageBlock | CodeMessageBlock {
  return 'content' in block && typeof (block as any).content === 'string'
}

class BlockCompressionService {
  private readonly COMPRESSION_THRESHOLD = 500 // 内存中块数量阈值
  private readonly LARGE_BLOCK_SIZE = 5000 // 大块大小阈值
  private originalContentCache = new Map<string, string>() // 缓存原始内容

  /**
   * 压缩内存中的大块以减少内存占用
   */
  public compressLargeBlocks() {
    try {
      const state = store.getState()
      const blockCount = Object.keys(state.messageBlocks.entities).length

      // 只有当块数量超过阈值时才进行压缩
      if (blockCount > this.COMPRESSION_THRESHOLD) {
        logger.debug(`Compressing large blocks, current count: ${blockCount}`)
        let compressedCount = 0

        Object.values(state.messageBlocks.entities).forEach((block) => {
          // 使用类型守卫确保块有 content 属性
          if (
            block &&
            (block.status === MessageBlockStatus.SUCCESS || block.status === MessageBlockStatus.ERROR) &&
            hasContent(block) &&
            block.content.length > this.LARGE_BLOCK_SIZE
          ) {
            // 创建压缩版本的块
            const compressedContent = this.compressContent(block.content)
            if (compressedContent !== block.content) {
              // 缓存原始内容
              this.originalContentCache.set(block.id, block.content)

              store.dispatch(
                updateOneBlock({
                  id: block.id,
                  changes: {
                    content: compressedContent,
                    isCompressed: true
                  }
                })
              )
              compressedCount++
            }
          }
        })

        logger.debug(`Compressed ${compressedCount} large blocks`)
      }
    } catch (error) {
      logger.error('Error compressing blocks:', error as Error)
    }
  }

  /**
   * 更智能的内容压缩（实际实现可以更复杂）
   */
  private compressContent(content: string): string {
    if (content.length <= this.LARGE_BLOCK_SIZE) {
      return content
    }

    // 保持更多的开头和结尾内容，提供更好的上下文
    const startLength = Math.min(2000, Math.floor(content.length * 0.1))
    const endLength = Math.min(2000, Math.floor(content.length * 0.1))

    const start = content.substring(0, startLength)
    const end = content.substring(content.length - endLength)
    const compressedSize = content.length - startLength - endLength

    return `${start}\n\n...[\u5df2压缩 ${compressedSize} 个字符的内容]...\n\n${end}`
  }

  /**
   * 解压缩块内容
   */
  public decompressBlock(blockId: string): string | null {
    return this.originalContentCache.get(blockId) || null
  }

  /**
   * 清理缓存的原始内容
   */
  public clearCache() {
    this.originalContentCache.clear()
  }

  /**
   * 获取缓存大小
   */
  public getCacheSize(): number {
    return this.originalContentCache.size
  }
}

export default new BlockCompressionService()
