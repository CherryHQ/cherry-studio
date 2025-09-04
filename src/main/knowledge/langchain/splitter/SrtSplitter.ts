import { Document } from '@langchain/core/documents'
import { TextSplitter, TextSplitterParams } from 'langchain/text_splitter'

// 定义一个接口来表示解析后的单个字幕片段
interface SrtSegment {
  text: string
  startTime: number // in seconds
  endTime: number // in seconds
}

// 辅助函数：将 SRT 时间戳字符串 (HH:MM:SS,ms) 转换为秒
function srtTimeToSeconds(time: string): number {
  const parts = time.split(':')
  const secondsAndMs = parts[2].split(',')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(secondsAndMs[0], 10)
  const milliseconds = parseInt(secondsAndMs[1], 10)

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
}

export class SrtSplitter extends TextSplitter {
  constructor(fields?: Partial<TextSplitterParams>) {
    // 传入 chunkSize 和 chunkOverlap
    super(fields)
  }
  splitText(): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  // 核心方法：重写 splitDocuments 来实现自定义逻辑
  async splitDocuments(documents: Document[]): Promise<Document[]> {
    const allChunks: Document[] = []

    for (const doc of documents) {
      // 1. 解析 SRT 内容
      const segments = this.parseSrt(doc.pageContent)
      if (segments.length === 0) continue

      // 2. 将字幕片段组合成块
      const chunks = this.mergeSegmentsIntoChunks(segments, doc.metadata)
      allChunks.push(...chunks)
    }

    return allChunks
  }

  // 辅助方法：解析整个 SRT 字符串
  private parseSrt(srt: string): SrtSegment[] {
    const segments: SrtSegment[] = []
    const blocks = srt.trim().split(/\n\n/)

    for (const block of blocks) {
      const lines = block.split('\n')
      if (lines.length < 3) continue

      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/)
      if (!timeMatch) continue

      const startTime = srtTimeToSeconds(timeMatch[1])
      const endTime = srtTimeToSeconds(timeMatch[2])
      const text = lines.slice(2).join(' ').trim()

      segments.push({ text, startTime, endTime })
    }

    return segments
  }

  // 辅助方法：将解析后的片段合并成每 5 段一个块
  private mergeSegmentsIntoChunks(segments: SrtSegment[], baseMetadata: Record<string, any>): Document[] {
    const chunks: Document[] = []
    let currentChunkText = ''
    let currentChunkStartTime = 0
    let currentChunkEndTime = 0
    let segmentCount = 0

    for (const segment of segments) {
      if (segmentCount === 0) {
        currentChunkStartTime = segment.startTime
      }

      currentChunkText += (currentChunkText ? ' ' : '') + segment.text
      currentChunkEndTime = segment.endTime
      segmentCount++

      // 当累积到 5 段时，创建一个新的 Document
      if (segmentCount === 5) {
        const metadata: Record<string, any> = {
          ...baseMetadata,
          startTime: currentChunkStartTime,
          endTime: currentChunkEndTime
        }
        if (baseMetadata.source_url) {
          metadata.source_url_with_timestamp = `${baseMetadata.source_url}?t=${Math.floor(currentChunkStartTime)}s`
        }
        chunks.push(
          new Document({
            pageContent: currentChunkText,
            metadata
          })
        )

        // 重置计数器和临时变量
        currentChunkText = ''
        currentChunkStartTime = 0
        currentChunkEndTime = 0
        segmentCount = 0
      }
    }

    // 如果还有剩余的片段，创建最后一个 Document
    if (segmentCount > 0) {
      const metadata: Record<string, any> = {
        ...baseMetadata,
        startTime: currentChunkStartTime,
        endTime: currentChunkEndTime
      }
      if (baseMetadata.source_url) {
        metadata.source_url_with_timestamp = `${baseMetadata.source_url}?t=${Math.floor(currentChunkStartTime)}s`
      }
      chunks.push(
        new Document({
          pageContent: currentChunkText,
          metadata
        })
      )
    }

    return chunks
  }
}
