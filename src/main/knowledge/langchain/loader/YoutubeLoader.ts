import { BaseDocumentLoader } from '@langchain/core/document_loaders/base'
import { Document } from '@langchain/core/documents'
import { Innertube } from 'youtubei.js'

// ... (接口定义 YoutubeConfig 和 VideoMetadata 保持不变)

/**
 * Configuration options for the YoutubeLoader class. Includes properties
 * such as the videoId, language, and addVideoInfo.
 */
interface YoutubeConfig {
  videoId: string
  language?: string
  addVideoInfo?: boolean
  // 新增一个选项，用于控制输出格式
  transcriptFormat?: 'text' | 'srt'
}

/**
 * Metadata of a YouTube video. Includes properties such as the source
 * (videoId), description, title, view_count, author, and category.
 */
interface VideoMetadata {
  source: string
  description?: string
  title?: string
  view_count?: number
  author?: string
  category?: string
}

/**
 * A document loader for loading data from YouTube videos. It uses the
 * youtubei.js library to fetch the transcript and video metadata.
 * @example
 * ```typescript
 * const loader = new YoutubeLoader({
 *   videoId: "VIDEO_ID",
 *   language: "en",
 *   addVideoInfo: true,
 *   transcriptFormat: "srt" // 获取 SRT 格式
 * });
 * const docs = await loader.load();
 * console.log(docs[0].pageContent);
 * ```
 */
export class YoutubeLoader extends BaseDocumentLoader {
  private videoId: string
  private language?: string
  private addVideoInfo: boolean
  // 新增格式化选项的私有属性
  private transcriptFormat: 'text' | 'srt'

  constructor(config: YoutubeConfig) {
    super()
    this.videoId = config.videoId
    this.language = config?.language
    this.addVideoInfo = config?.addVideoInfo ?? false
    // 初始化格式化选项，默认为 'text' 以保持向后兼容
    this.transcriptFormat = config?.transcriptFormat ?? 'text'
  }

  /**
   * Extracts the videoId from a YouTube video URL.
   * @param url The URL of the YouTube video.
   * @returns The videoId of the YouTube video.
   */
  private static getVideoID(url: string): string {
    const match = url.match(/.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=)([^#&?]*).*/)
    if (match !== null && match[1].length === 11) {
      return match[1]
    } else {
      throw new Error('Failed to get youtube video id from the url')
    }
  }

  /**
   * Creates a new instance of the YoutubeLoader class from a YouTube video
   * URL.
   * @param url The URL of the YouTube video.
   * @param config Optional configuration options for the YoutubeLoader instance, excluding the videoId.
   * @returns A new instance of the YoutubeLoader class.
   */
  static createFromUrl(url: string, config?: Omit<YoutubeConfig, 'videoId'>): YoutubeLoader {
    const videoId = YoutubeLoader.getVideoID(url)
    return new YoutubeLoader({ ...config, videoId })
  }

  /**
   * [新增] 辅助函数：将毫秒转换为 SRT 时间戳格式 (HH:MM:SS,ms)
   * @param ms 毫秒数
   * @returns 格式化后的时间字符串
   */
  private static formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, '0')
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0')
    const seconds = (totalSeconds % 60).toString().padStart(2, '0')
    const milliseconds = (ms % 1000).toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds},${milliseconds}`
  }

  /**
   * Loads the transcript and video metadata from the specified YouTube
   * video. It can return the transcript as plain text or in SRT format.
   * @returns An array of Documents representing the retrieved data.
   */
  async load(): Promise<Document[]> {
    const metadata: VideoMetadata = {
      source: this.videoId
    }

    try {
      const youtube = await Innertube.create({
        lang: this.language,
        retrieve_player: false
      })

      const info = await youtube.getInfo(this.videoId)
      const transcriptData = await info.getTranscript()

      if (!transcriptData.transcript.content?.body?.initial_segments) {
        throw new Error('Transcript segments not found in the response.')
      }

      const segments = transcriptData.transcript.content.body.initial_segments

      let pageContent: string

      // 根据 transcriptFormat 选项决定如何格式化字幕
      if (this.transcriptFormat === 'srt') {
        // [修改] 将字幕片段格式化为 SRT 格式
        pageContent = segments
          .map((segment, index) => {
            const srtIndex = index + 1
            const startTime = YoutubeLoader.formatTimestamp(Number(segment.start_ms))
            const endTime = YoutubeLoader.formatTimestamp(Number(segment.end_ms))
            const text = segment.snippet?.text || '' // 使用 segment.snippet.text

            return `${srtIndex}\n${startTime} --> ${endTime}\n${text}`
          })
          .join('\n\n') // 每个 SRT 块之间用两个换行符分隔
      } else {
        // [原始逻辑] 拼接为纯文本
        pageContent = segments.map((segment) => segment.snippet?.text || '').join(' ')
      }

      if (this.addVideoInfo) {
        const basicInfo = info.basic_info
        metadata.description = basicInfo.short_description
        metadata.title = basicInfo.title
        metadata.view_count = basicInfo.view_count
        metadata.author = basicInfo.author
      }

      const document = new Document({
        pageContent,
        metadata
      })

      return [document]
    } catch (e: unknown) {
      throw new Error(`Failed to get YouTube video transcription: ${(e as Error).message}`)
    }
  }
}
