import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { BaseLoader } from '@llm-tools/embedjs-interfaces'
import { cleanString } from '@llm-tools/embedjs-utils'
import AdmZip from 'adm-zip'
import Logger from 'electron-log'
import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import * as xml2js from 'xml2js'

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
   * 解析XML数据为JavaScript对象
   * @param xmlData XML数据字符串
   * @returns 解析后的JavaScript对象
   */
  private async parseXml(xmlData: string): Promise<any> {
    const parser = new xml2js.Parser({ explicitArray: false });
    const parseString = util.promisify(parser.parseString.bind(parser));
    return await parseString(xmlData);
  }

  /**
   * 从EPUB文件中提取容器信息，找到content.opf文件的路径
   * @param zip AdmZip实例
   * @returns content.opf文件的路径
   */
  private async getContentOpfPath(zip: AdmZip): Promise<string> {
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) {
      throw new Error('Container.xml not found in EPUB');
    }

    const containerXml = containerEntry.getData().toString('utf8');
    const containerData = await this.parseXml(containerXml);
    const rootfile = containerData.container.rootfiles.rootfile;
    
    if (Array.isArray(rootfile)) {
      return rootfile[0].$['full-path'];
    } else {
      return rootfile.$['full-path'];
    }
  }

  /**
   * 从content.opf文件中提取元数据和章节信息
   * @param zip AdmZip实例
   * @param contentOpfPath content.opf文件的路径
   * @returns 元数据和章节信息
   */
  private async extractMetadataAndChapters(zip: AdmZip, contentOpfPath: string): Promise<{ metadata: EpubMetadata; chapters: EpubChapter[] }> {
    const contentEntry = zip.getEntry(contentOpfPath);
    if (!contentEntry) {
      throw new Error(`Content file not found: ${contentOpfPath}`);
    }

    const contentXml = contentEntry.getData().toString('utf8');
    const contentData = await this.parseXml(contentXml);
    
    // 提取元数据
    const metadataObj = contentData.package.metadata;
    const metadata: EpubMetadata = {
      creator: this.extractValue(metadataObj, 'dc:creator'),
      title: this.extractValue(metadataObj, 'dc:title'),
      language: this.extractValue(metadataObj, 'dc:language'),
      subject: this.extractValue(metadataObj, 'dc:subject'),
      date: this.extractValue(metadataObj, 'dc:date'),
      description: this.extractValue(metadataObj, 'dc:description')
    };

    // 提取目录结构
    const spine = contentData.package.spine;
    const manifest = contentData.package.manifest;
    
    if (!spine || !spine.itemref || !manifest || !manifest.item) {
      throw new Error('EPUB spine or manifest missing');
    }

    // 将manifest项目转换为id-href映射
    const items: Record<string, string> = {};
    const manifestItems = Array.isArray(manifest.item) ? manifest.item : [manifest.item];
    
    for (const item of manifestItems) {
      items[item.$.id] = item.$.href;
    }

    // 提取章节信息
    const itemrefs = Array.isArray(spine.itemref) ? spine.itemref : [spine.itemref];
    const chapters: EpubChapter[] = [];
    
    const basePath = path.dirname(contentOpfPath);
    
    for (let i = 0; i < itemrefs.length; i++) {
      const itemId = itemrefs[i].$.idref;
      const href = items[itemId];
      
      if (href) {
        const chapterPath = path.join(basePath, href).replace(/\\/g, '/');
        chapters.push({
          id: chapterPath,
          title: `Chapter ${i + 1}`,
          order: i + 1
        });
      }
    }

    return { metadata, chapters };
  }

  /**
   * 从元数据对象中提取指定字段的值
   * @param metadata 元数据对象
   * @param field 字段名
   * @returns 字段值
   */
  private extractValue(metadata: any, field: string): string | undefined {
    if (!metadata) return undefined;
    
    const value = metadata[field];
    if (!value) return undefined;
    
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0]?._  || value[0];
    return value._ || value;
  }

  /**
   * 提取章节内容
   * @param zip AdmZip实例
   * @param chapterId 章节ID（文件路径）
   * @returns 章节内容
   */
  private getChapterContent(zip: AdmZip, chapterId: string): string {
    const entry = zip.getEntry(chapterId);
    if (!entry) {
      Logger.warn(`[EpubLoader] Chapter not found: ${chapterId}`);
      return '';
    }
    
    return entry.getData().toString('utf8');
  }

  /**
   * 从 epub 文件中提取文本内容
   * 1. 检查文件是否存在
   * 2. 使用AdmZip打开EPUB文件
   * 3. 提取元数据和章节信息
   * 4. 遍历所有章节并提取文本
   * 5. 清理 HTML 标签
   * 6. 合并所有章节文本
   */
  private async extractTextFromEpub() {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(this.filePath)) {
        throw new Error(`File not found: ${this.filePath}`)
      }

      // 使用AdmZip打开EPUB文件
      const zip = new AdmZip(this.filePath);
      
      // 获取content.opf文件路径
      const contentOpfPath = await this.getContentOpfPath(zip);
      
      // 提取元数据和章节信息
      const { metadata, chapters } = await this.extractMetadataAndChapters(zip, contentOpfPath);
      this.metadata = metadata;
      
      if (chapters.length === 0) {
        throw new Error('No content found in epub file');
      }

      const chapterTexts: string[] = [];

      // 遍历所有章节
      for (const chapter of chapters) {
        try {
          const content = this.getChapterContent(zip, chapter.id);

          if (!content) {
            continue;
          }

          // 移除 HTML 标签并清理文本
          const text = content
            .replace(/<[^>]*>/g, ' ') // 移除所有 HTML 标签
            .replace(/\s+/g, ' ') // 将多个空白字符替换为单个空格
            .trim(); // 移除首尾空白

          if (text) {
            chapterTexts.push(text);
          }
        } catch (error) {
          Logger.error(`[EpubLoader] Error processing chapter ${chapter.id}:`, error);
        }
      }

      // 使用双换行符连接所有章节文本
      this.extractedText = chapterTexts.join('\n\n');
    } catch (error) {
      Logger.error('[EpubLoader] Error in extractTextFromEpub:', error);
      throw error;
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
