import { Client } from '@notionhq/client'
import { FileType, FileTypes, KnowledgeItem } from '@renderer/types'

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
      // Create a Set to track processed file names
      const processedFiles = new Set<string>()
      const fileMap = new Map(
        fileItems.map((item) => {
          const fileType = item.content as FileType
          processedFiles.add(fileType.origin_name) // Record existing files
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

            // Check if this file has already been processed
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
            // Check if the page content is empty
            if (!pageContent.trim()) {
              console.log(`[NotionService] Skip empty page: ${fileName}`)
              continue
            }
            console.log('fileName:', fileName)
            try {
              // 使用专门的外部导入方法
              const filePath = await window.api.file.importFromExternalSource(pageContent, fileName, 'notion', '.md')

              // 创建文件对象
              const uploadedFile: FileType = {
                id: fileName,
                name: fileName,
                path: filePath as string,
                origin_name: fileName,
                size: pageContent.length,
                ext: '.md',
                type: FileTypes.EXTERNAL,
                count: 1,
                created_at: new Date(),
                externalSource: 'notion'
              }
              allFiles.push(uploadedFile)
            } catch (error) {
              console.error('[NotionService] Failed to import Notion content:', error)
            }
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
      // Replace Windows and Unix system illegal characters
      .replace(/[<>:"/\\|?*]/g, '_')
      // Replace files starting with a dot (.)
      .replace(/^\.+/, '_')
      // Replace macOS colon (:) with underscore
      .replace(/:/g, '_')
      // Remove trailing dots and spaces
      .replace(/[. ]+$/, '')
      // Ensure file name is not empty
      .replace(/^$/, '_')
      .slice(0, 255)
  )
}
