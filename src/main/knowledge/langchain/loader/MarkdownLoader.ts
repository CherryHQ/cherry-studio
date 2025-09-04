import { BaseDocumentLoader } from '@langchain/core/document_loaders/base'
import { Document } from '@langchain/core/documents'
import { readTextFileWithAutoEncoding } from '@main/utils/file'
import MarkdownIt from 'markdown-it'

export class MarkdownLoader extends BaseDocumentLoader {
  private path: string
  private md: MarkdownIt

  constructor(path: string) {
    super()
    this.path = path
    this.md = new MarkdownIt()
  }
  public async load(): Promise<Document[]> {
    const content = await readTextFileWithAutoEncoding(this.path)
    return this.parseMarkdown(content)
  }

  private parseMarkdown(content: string): Document[] {
    const tokens = this.md.parse(content, {})
    const documents: Document[] = []

    let currentSection: {
      heading?: string
      level?: number
      content: string
      startLine?: number
    } = { content: '' }

    let i = 0
    while (i < tokens.length) {
      const token = tokens[i]

      if (token.type === 'heading_open') {
        // Save previous section if it has content
        if (currentSection.content.trim()) {
          documents.push(
            new Document({
              pageContent: currentSection.content.trim(),
              metadata: {
                source: this.path,
                heading: currentSection.heading || 'Introduction',
                level: currentSection.level || 0,
                startLine: currentSection.startLine || 0
              }
            })
          )
        }

        // Start new section
        const level = parseInt(token.tag.slice(1)) // Extract number from h1, h2, etc.
        const headingContent = tokens[i + 1]?.content || ''

        currentSection = {
          heading: headingContent,
          level: level,
          content: '',
          startLine: token.map?.[0] || 0
        }

        // Skip heading_open, inline, heading_close tokens
        i += 3
        continue
      }

      // Add token content to current section
      if (token.content) {
        currentSection.content += token.content
      }

      // Add newlines for block tokens
      if (token.block && token.type !== 'heading_close') {
        currentSection.content += '\n'
      }

      i++
    }

    // Add the last section
    if (currentSection.content.trim()) {
      documents.push(
        new Document({
          pageContent: currentSection.content.trim(),
          metadata: {
            source: this.path,
            heading: currentSection.heading || 'Introduction',
            level: currentSection.level || 0,
            startLine: currentSection.startLine || 0
          }
        })
      )
    }

    return documents
  }
}
