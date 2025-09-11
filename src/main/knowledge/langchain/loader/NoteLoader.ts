import { BaseDocumentLoader } from '@langchain/core/document_loaders/base'
import { Document } from '@langchain/core/documents'

export class NoteLoader extends BaseDocumentLoader {
  private text: string
  private sourceUrl?: string
  constructor(
    public _text: string,
    public _sourceUrl?: string
  ) {
    super()
    this.text = _text
    this.sourceUrl = _sourceUrl
  }

  /**
   * A protected method that takes a `raw` string as a parameter and returns
   * a promise that resolves to an array containing the raw text as a single
   * element.
   * @param raw The raw text to be parsed.
   * @returns A promise that resolves to an array containing the raw text as a single element.
   */
  protected async parse(raw: string): Promise<string[]> {
    return [raw]
  }

  public async load(): Promise<Document[]> {
    const metadata = { source: this.sourceUrl || 'note' }
    const parsed = await this.parse(this.text)
    parsed.forEach((pageContent, i) => {
      if (typeof pageContent !== 'string') {
        throw new Error(`Expected string, at position ${i} got ${typeof pageContent}`)
      }
    })

    return parsed.map(
      (pageContent, i) =>
        new Document({
          pageContent,
          metadata:
            parsed.length === 1
              ? metadata
              : {
                  ...metadata,
                  line: i + 1
                }
        })
    )
  }
}
