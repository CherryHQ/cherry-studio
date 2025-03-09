import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { BaseLoader } from '@llm-tools/embedjs-interfaces'
import { cleanString } from '@llm-tools/embedjs-utils'
import { getTempDir } from '@main/utils/file'
import Logger from 'electron-log'
import EPub from 'epub'
import * as fs from 'fs'
import path from 'path'

/**
 * epub 加载器的配置选项
 */
interface EpubLoaderOptions {
  /** epub 文件路径 */
  filePath: string
  /** 文本分块大小 */
  chunkSize: number
  /** 分块重叠大小 */
  chunkOverlap: number
}

/**
 * epub 文件的元数据信息
 */
interface EpubMetadata {
  /** 作者显示名称（例如："Lewis Carroll"） */
  creator?: string
  /** 作者规范化名称，用于排序和索引（例如："Carroll, Lewis"） */
  creatorFileAs?: string
  /** 书籍标题（例如："Alice's Adventures in Wonderland"） */
  title?: string
  /** 语言代码（例如："en" 或 "zh-CN"） */
  language?: string
  /** 主题或分类（例如："Fantasy"、"Fiction"） */
  subject?: string
  /** 创建日期（例如："2024-02-14"） */
  date?: string
  /** 书籍描述或简介 */
  description?: string
}

/**
 * epub 章节信息
 */
interface EpubChapter {
  /** 章节 ID */
  id: string
  /** 章节标题 */
  title?: string
  /** 章节顺序 */
  order?: number
}

/**
 * epub 文件加载器
 * 用于解析 epub 电子书文件，提取文本内容和元数据
 */
export class EpubLoader extends BaseLoader<Record<string, string | number | boolean>, Record<string, unknown>> {
  protected filePath: string
  protected chunkSize: number
  protected chunkOverlap: number
  private extractedText: string
  private metadata: EpubMetadata | null

  /**
   * 创建 epub 加载器实例
   * @param options 加载器配置选项
   */
  constructor(options: EpubLoaderOptions) {
    super(options.filePath, {
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap
    })
    this.filePath = options.filePath
    this.chunkSize = options.chunkSize
    this.chunkOverlap = options.chunkOverlap
    this.extractedText = ''
    this.metadata = null
  }

  /**
   * 等待 epub 文件初始化完成
   * epub 库使用事件机制，需要等待 'end' 事件触发后才能访问文件内容
   * @param epub epub 实例
   * @returns 元数据和章节信息
   */
  private waitForEpubInit(epub: any): Promise<{ metadata: EpubMetadata; chapters: EpubChapter[] }> {
    return new Promise((resolve, reject) => {
      epub.on('end', () => {
        // 提取元数据
        const metadata: EpubMetadata = {
          creator: epub.metadata.creator,
          creatorFileAs: epub.metadata.creatorFileAs,
          title: epub.metadata.title,
          language: epub.metadata.language,
          subject: epub.metadata.subject,
          date: epub.metadata.date,
          description: epub.metadata.description
        }

        // 提取章节信息
        const chapters: EpubChapter[] = epub.flow.map((chapter: any, index: number) => ({
          id: chapter.id,
          title: chapter.title || `Chapter ${index + 1}`,
          order: index + 1
        }))

        resolve({ metadata, chapters })
      })

      epub.on('error', (error: Error) => {
        reject(error)
      })

      epub.parse()
    })
  }

  /**
   * 获取章节内容
   * @param epub epub 实例
   * @param chapterId 章节 ID
   * @returns 章节文本内容
   */
  private getChapter(epub: any, chapterId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      epub.getChapter(chapterId, (error: Error | null, text: string) => {
        if (error) {
          reject(error)
        } else {
          resolve(text)
        }
      })
    })
  }

  /**
   * 从 epub 文件中提取文本内容
   * 1. 检查文件是否存在
   * 2. 初始化 epub 并获取元数据
   * 3. 遍历所有章节并提取文本
   * 4. 清理 HTML 标签
   * 5. 合并所有章节文本
   */
  private async extractTextFromEpub() {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(this.filePath)) {
        throw new Error(`File not found: ${this.filePath}`)
      }

      const epub = new EPub(this.filePath)

      // 等待 epub 初始化完成并获取元数据
      const { metadata, chapters } = await this.waitForEpubInit(epub)
      this.metadata = metadata

      if (!epub.flow || epub.flow.length === 0) {
        throw new Error('No content found in epub file')
      }

      // 使用临时文件而不是内存数组
      const tempFilePath = path.join(getTempDir(), `epub-${Date.now()}.txt`)
      const writeStream = fs.createWriteStream(tempFilePath)

      // 遍历所有章节
      for (const chapter of chapters) {
        try {
          const content = await this.getChapter(epub, chapter.id)

          if (!content) {
            continue
          }

          // 移除 HTML 标签并清理文本
          const text = content
            .replace(/<[^>]*>/g, ' ') // 移除所有 HTML 标签
            .replace(/\s+/g, ' ') // 将多个空白字符替换为单个空格
            .trim() // 移除首尾空白

          if (text) {
            // 直接写入文件
            writeStream.write(text + '\n\n')
          }
        } catch (error) {
          Logger.error(`[EpubLoader] Error processing chapter ${chapter.id}:`, error)
        }
      }

      // 关闭写入流
      writeStream.end()

      // 等待写入完成
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })

      // 从临时文件读取内容
      this.extractedText = fs.readFileSync(tempFilePath, 'utf-8')

      // 删除临时文件
      fs.unlinkSync(tempFilePath)

      // 只添加一条完成日志
      Logger.info(`[EpubLoader] 电子书 ${this.metadata?.title || path.basename(this.filePath)} 处理完成`)
    } catch (error) {
      Logger.error('[EpubLoader] Error in extractTextFromEpub:', error)
      throw error
    }
  }

  /**
   * 生成文本块
   * 重写 BaseLoader 的方法，将提取的文本分割成适当大小的块
   * 每个块都包含源文件和元数据信息
   */
  override async *getUnfilteredChunks() {
    // 如果还没有提取文本，先提取
    if (!this.extractedText) {
      await this.extractTextFromEpub()
    }

    Logger.info('[EpubLoader] 书名：', this.metadata?.title || '未知书名', ' 文本大小：', this.extractedText.length)

    // 创建文本分块器
    const chunker = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap
    })

    // 清理并分割文本
    const chunks = await chunker.splitText(cleanString(this.extractedText))

    // 为每个文本块添加元数据
    for (const chunk of chunks) {
      yield {
        pageContent: chunk,
        metadata: {
          source: this.filePath,
          title: this.metadata?.title || '',
          creator: this.metadata?.creator || '',
          language: this.metadata?.language || ''
        }
      }
    }
  }
}
