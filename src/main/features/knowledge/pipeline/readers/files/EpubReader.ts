import { Document, FileReader, type Metadata } from '@vectorstores/core'
import { HTMLReader } from '@vectorstores/readers/html'
import EPub from 'epub'

import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeEpubReader')

export class EpubReader extends FileReader<Document<Metadata>> {
  /**
   * An EPUB chapter is XHTML: a regex strip kept the `<style>` and `<script>` contents, and without the
   * reader's own options entities are decoded first, so an escaped `&lt;div&gt;` is cut as a tag.
   */
  private readonly htmlReader = new HTMLReader()

  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    const epub = new EPub(Buffer.from(fileContent))
    await epub.parse()

    const chapters = epub.flow ?? []
    const documents: Document<Metadata>[] = []
    const failedChapterIds: string[] = []

    for (const chapter of chapters) {
      try {
        const content = await epub.getChapter(chapter.id)
        const text = (await this.htmlReader.parseContent(content, this.htmlReader.getOptions())).trim()

        if (!text) {
          continue
        }

        documents.push(
          new Document({
            text
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
