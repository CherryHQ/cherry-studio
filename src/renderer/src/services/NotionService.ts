import { Client } from '@notionhq/client'
import { FileType, FileTypes, KnowledgeItem } from '@renderer/types'

import FileManager from './FileManager'

export class NotionService {
  private client: Client
  private PAGE_SIZE = 10

  constructor(private apiKey: string) {
    this.client = new Client({
      auth: apiKey
    })
  }

  async getDatabaseContent(databaseId: string, fileItems: KnowledgeItem[]): Promise<FileType[]> {
    try {
      console.log('[NotionService] fileItems:', fileItems)
      // 创建一个 Set 来跟踪已处理的文件名
      const processedFiles = new Set<string>()
      const fileMap = new Map(
        fileItems.map((item) => {
          const fileType = item.content as FileType
          processedFiles.add(fileType.origin_name) // 记录已存在的文件
          return [fileType.origin_name, item]
        })
      )
      const allFiles: FileType[] = []
      let hasMore = true
      let startCursor: string | undefined = undefined

      while (hasMore) {
        const response = await this.client.databases.query({
          database_id: databaseId,
          page_size: this.PAGE_SIZE,
          start_cursor: startCursor
        })

        for (const page of response.results) {
          try {
            const pageTitle = this.extractPageTitle(page)
            const fileName = sanitizeFileName(`${pageTitle || 'Untitled'}`)

            // 检查是否已处理过这个文件
            if (processedFiles.has(fileName)) {
              console.log(`[NotionService] Skip existing file: ${fileName}`)
              continue
            }
            processedFiles.add(fileName)

            const fileItem = fileMap.get(fileName)
            if (fileItem) {
              continue
            }
            // Get page content from Notion
            const pageContent = await this.getPageContent(page.id)
            // 检查页面内容是否为空
            if (!pageContent.trim()) {
              console.log(`[NotionService] Skip empty page: ${fileName}`)
              continue
            }
            console.log('fileName:', fileName)

            // 直接创建 FileType 对象，包含 content
            const fileObj: FileType = {
              id: fileName,
              name: fileName,
              path: '',
              origin_name: `${fileName}.md` || 'Untitled.md',
              size: pageContent.length,
              ext: '.md',
              type: FileTypes.DOCUMENT,
              created_at: new Date(),
              count: 1
            }
            const tempFilePath = await window.api.file.createOrgin(`${fileName}.md`)
            await window.api.file.write(tempFilePath, pageContent)
            const uploadedFile = await FileManager.uploadFile({
              ...fileObj,
              path: tempFilePath || ''
            })
            allFiles.push(uploadedFile)
            console.log('allFiles:', allFiles)
          } catch (error) {
            console.error(`Failed to process Notion page ${page.id}:`, error)
          }
        }

        hasMore = response.has_more
        startCursor = response.next_cursor || undefined
      }

      return allFiles
    } catch (error) {
      console.error('Failed to fetch Notion database:', error)
      throw error
    }
  }
  async getPageContent(pageId: string): Promise<string> {
    const blocks = await this.client.blocks.children.list({
      block_id: pageId
    })

    return blocks.results
      .map((block: any) => {
        return this.renderBlock(block)
      })
      .filter(Boolean)
      .join('\n\n')
  }

  private renderBlock(block: any): string {
    const { type } = block
    const content = block[type]

    switch (type) {
      case 'paragraph':
        return this.extractRichText(content.rich_text)
      case 'heading_1':
        return `# ${this.extractRichText(content.rich_text)}`
      case 'heading_2':
        return `## ${this.extractRichText(content.rich_text)}`
      case 'heading_3':
        return `### ${this.extractRichText(content.rich_text)}`
      case 'bulleted_list_item':
        return `* ${this.extractRichText(content.rich_text)}`
      case 'numbered_list_item':
        return `1. ${this.extractRichText(content.rich_text)}`
      case 'to_do':
        return `- [${content.checked ? 'x' : ' '}] ${this.extractRichText(content.rich_text)}`
      case 'code':
        return `\`\`\`${content.language}\n${this.extractRichText(content.rich_text)}\n\`\`\``
      case 'quote':
        return `> ${this.extractRichText(content.rich_text)}`
      default:
        return this.extractRichText(content?.rich_text || [])
    }
  }

  private extractRichText(richText: any[]): string {
    return richText?.map((text: any) => text.plain_text).join('') || ''
  }

  private extractPageTitle(page: any): string {
    const titleProperty = Object.values(page.properties).find((prop: any) => prop.type === 'title') as any
    return titleProperty?.title?.[0]?.plain_text || ''
  }
}

export const sanitizeFileName = (fileName: string): string => {
  return (
    fileName
      // 替换 Windows 和 Unix 系统中的非法字符
      .replace(/[<>:"/\\|?*]/g, '_')
      // 替换以点（.）开头的文件名
      .replace(/^\.+/, '_')
      // 替换 macOS 中的冒号（:）为下划线
      .replace(/:/g, '_')
      // 移除末尾的点和空格
      .replace(/[. ]+$/, '')
      // 确保文件名不为空
      .replace(/^$/, '_')
      .slice(0, 255)
  )
}
