import { Document, FileReader, type Metadata } from '@vectorstores/core'
import { HTMLReader } from '@vectorstores/readers/html'
import EPub from 'epub'

import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeEpubReader')

export class EpubReader extends FileReader<Document<Metadata>> {
  /**
   * An EPUB chapter is XHTML, so it is read with the same reader a standalone
   * .html file gets. Stripping tags with a regex instead kept whatever sat
   * inside `<style>` and `<script>` - an inline stylesheet is ordinary in an
   * EPUB chapter - and left entities undecoded, so `it&#8217;s` was indexed
   * instead of `it's`.
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
        const text = (await this.htmlReader.parseContent(content)).trim()

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
