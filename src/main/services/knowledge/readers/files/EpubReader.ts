import { loggerService } from '@logger'
import { Document, FileReader, type Metadata } from '@vectorstores/core'
import EPub from 'epub'

const logger = loggerService.withContext('KnowledgeEpubReader')

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class EpubReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    const epub = new EPub(Buffer.from(fileContent))
    await epub.parse()

    const chapters = epub.flow ?? []
    const documents: Document<Metadata>[] = []
    const failedChapterIds: string[] = []

    for (const [index, chapter] of chapters.entries()) {
      try {
        const content = await epub.getChapter(chapter.id)
        const text = stripHtml(content)

        if (!text) {
          continue
        }

        documents.push(
          new Document({
            text,
            metadata: {
              source: filename,
              title: epub.metadata.title || filename || '',
              creator: epub.metadata.creator || '',
              language: epub.metadata.language || '',
              chapterId: chapter.id,
              chapterTitle: chapter.title || `Chapter ${index + 1}`,
              chapterOrder: index + 1
            }
          })
        )
      } catch (error) {
        failedChapterIds.push(chapter.id)
        logger.error('Failed to read epub chapter', error as Error, {
          filename,
          chapterId: chapter.id
        })
      }
    }

    if (failedChapterIds.length > 0) {
      throw new Error(`Failed to read epub chapters: ${failedChapterIds.join(', ')}`)
    }

    return documents
  }
}
