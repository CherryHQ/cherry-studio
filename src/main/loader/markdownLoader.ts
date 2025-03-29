import { BaseLoader } from '@cherrystudio/embedjs-interfaces'
import { cleanString, truncateCenterString } from '@cherrystudio/embedjs-utils'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { ImageArea } from '@main/utils/markdown'
import createDebugMessages from 'debug'
import Logger from 'electron-log'
import md5 from 'md5'

interface ChunkWithOffsets {
  text: string
  startOffset: number
  endOffset: number
}
export class MarkdownLoader extends BaseLoader<{ type: 'MarkdownLoader' }> {
  private readonly debug = createDebugMessages('embedjs:loader:MarkdownLoader')
  private readonly text: string
  private readonly imageAreas: ImageArea[] // 新增：存储图片区域信息
  constructor({
    text,
    imageAreas = [], // 新增：接收图片区域数组，默认为空
    chunkSize,
    chunkOverlap
  }: {
    text: string
    imageAreas?: ImageArea[] // 可选参数
    chunkSize?: number
    chunkOverlap?: number
  }) {
    // 注意：修改了元数据类型以包含可选的图片信息
    super(`MarkdownLoader_${md5(text)}`, { text }, chunkSize ?? 1000, chunkOverlap ?? 0)
    this.text = text
    this.imageAreas = imageAreas // 存储传入的图片区域
    this.debug(`Initialized MarkdownLoader with ${this.imageAreas.length} image areas.`)
  }
  /**
   * 辅助方法：分割文本并尝试获取每个块的偏移量。
   * 注意：此实现使用 indexOf，对于重复文本块可能不精确。
   * 更健壮的方法可能需要自定义分割逻辑或使用支持偏移量的库。
   */
  private async splitTextWithOffsets(textToSplit: string): Promise<ChunkWithOffsets[]> {
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      keepSeparator: false // 根据需要调整
    })
    const textChunks = await textSplitter.splitText(textToSplit)
    const chunksWithOffsets: ChunkWithOffsets[] = []
    let currentSearchOffset = 0
    this.debug(`Splitting text into chunks... Total text length: ${textToSplit.length}`)
    for (const chunkText of textChunks) {
      const startOffset = textToSplit.indexOf(chunkText, currentSearchOffset)
      if (startOffset !== -1) {
        const endOffset = startOffset + chunkText.length
        chunksWithOffsets.push({ text: chunkText, startOffset, endOffset })
        // 更新下一个搜索的起始点，尝试处理重叠
        // 一个简单的策略是基于当前找到的块的起始位置前进一点
        // 或是基于结束位置回退重叠量，但这取决于 splitter 内部逻辑
        // 使用 startOffset + 1 避免在同一位置重复找到完全相同的短块
        currentSearchOffset = startOffset + 1
        // 或者更保守地基于结束位置：
        // currentSearchOffset = endOffset - this.chunkOverlap;
      } else {
        // 如果找不到，可能意味着 cleanString 移除了某些字符，
        // 或者文本块非常特殊/重复。记录警告。
        this.debug(
          `Warning: Could not reliably find offset for chunk starting with: "${chunkText.substring(0, 30)}..."`
        )
        // 可以选择跳过这个块，或者赋予一个无效/估算的偏移量
        // chunksWithOffsets.push({ text: chunkText, startOffset: -1, endOffset: -1 });
      }
    }
    this.debug(`Found offsets for ${chunksWithOffsets.length} chunks.`)
    return chunksWithOffsets
  }
  override async *getUnfilteredChunks() {
    const tuncatedObjectString = truncateCenterString(this.text, 50)
    this.debug('Starting chunk generation...')
    Logger.info('###### MarkdownLoader getUnfilteredChunks ######')
    try {
      // 1. 使用辅助方法获取带偏移量的块
      const chunksWithOffsets = await this.splitTextWithOffsets(cleanString(this.text))
      // 2. 遍历带偏移量的块，并检查与图片区域的重叠
      for (const chunk of chunksWithOffsets) {
        const chunkMetadata: { type: 'MarkdownLoader'; source: string; has_image?: boolean; image_paths?: string[] } = {
          type: 'MarkdownLoader' as const,
          source: tuncatedObjectString
        }
        const overlappingImagePaths: string[] = []
        // 检查当前块是否与任何图片区域重叠
        for (const area of this.imageAreas) {
          const chunkStart = chunk.startOffset
          const chunkEnd = chunk.endOffset
          const areaStart = area.areaPosition.startOffset
          const areaEnd = area.areaPosition.endOffset
          // 重叠条件：max(start1, start2) < min(end1, end2)
          const overlaps = Math.max(chunkStart, areaStart) < Math.min(chunkEnd, areaEnd)
          if (overlaps) {
            overlappingImagePaths.push(area.url)
          }
        }
        // 如果有重叠，添加元数据
        if (overlappingImagePaths.length > 0) {
          chunkMetadata.has_image = true
          chunkMetadata.image_paths = overlappingImagePaths

          Logger.info({
            message: `Chunk with images found`,
            chunk: chunk.text,
            metadata: chunkMetadata
          })
          this.debug(
            `Chunk starting at offset ${chunk.startOffset} overlaps with images: ${overlappingImagePaths.join(', ')}`
          )
        }
        // 3. Yield 最终的 Document 对象
        yield {
          pageContent: chunk.text,
          metadata: chunkMetadata
        }
      }
      this.debug(`MarkdownLoader processing finished for source '${tuncatedObjectString}'`)
    } catch (e: any) {
      this.debug(`Error during chunk generation for source '${tuncatedObjectString}':`, e.message, e.stack)
      // 可以选择抛出错误或继续处理（如果适用）
      // throw e;
    }
  }
}
