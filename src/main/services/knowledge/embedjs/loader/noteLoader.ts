import { BaseLoader } from '@cherrystudio/embedjs-interfaces'
import { cleanString } from '@cherrystudio/embedjs-utils'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import md5 from 'md5'

export class NoteLoader extends BaseLoader<{ type: 'NoteLoader' }> {
  private readonly text: string
  private readonly sourceUrl?: string

  constructor({
    text,
    sourceUrl,
    chunkSize,
    chunkOverlap
  }: {
    text: string
    sourceUrl?: string
    chunkSize?: number
    chunkOverlap?: number
  }) {
    super(`NoteLoader_${md5(text + (sourceUrl || ''))}`, { text, sourceUrl }, chunkSize ?? 2000, chunkOverlap ?? 0)
    this.text = text
    this.sourceUrl = sourceUrl
  }

  override async *getUnfilteredChunks() {
    const chunker = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap
    })

    const chunks = await chunker.splitText(cleanString(this.text))

    for (const chunk of chunks) {
      yield {
        pageContent: chunk,
        metadata: {
          type: 'NoteLoader' as const,
          source: this.sourceUrl || 'note'
        }
      }
    }
  }
}
