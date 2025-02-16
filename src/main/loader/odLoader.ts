import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { BaseLoader } from '@llm-tools/embedjs-interfaces'
import { cleanString } from '@llm-tools/embedjs-utils'
import md5 from 'md5'
import { OfficeParserConfig, parseOfficeAsync } from 'officeparser'

export enum OdType {
  OdtLoader = 'OdtLoader',
  OdsLoader = 'OdsLoader',
  OdpLoader = 'OdpLoader',
  undefined = 'undefined'
}

export class OdLoader<OdType> extends BaseLoader<{ type: string }> {
  private readonly odType: OdType
  private readonly filePath: string
  private extractedText: string
  private config: OfficeParserConfig

  constructor({
    odType,
    filePath,
    chunkSize,
    chunkOverlap
  }: {
    odType: OdType
    filePath: string
    chunkSize?: number
    chunkOverlap?: number
  }) {
    super(`${odType}_${md5(filePath)}`, { filePath }, chunkSize ?? 1000, chunkOverlap ?? 0)
    this.odType = odType
    this.filePath = filePath
    this.extractedText = ''
    this.config = {
      newlineDelimiter: ' ',
      ignoreNotes: false
    }
  }

  private async extractTextFromOdt() {
    try {
      this.extractedText = await parseOfficeAsync(this.filePath, this.config)
    } catch (err) {
      console.error('odLoader error', err)
      throw err
    }
  }

  override async *getUnfilteredChunks() {
    if (!this.extractedText) {
      await this.extractTextFromOdt()
    }
    const chunker = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap
    })

    const chunks = await chunker.splitText(cleanString(this.extractedText))

    for (const chunk of chunks) {
      yield {
        pageContent: chunk,
        metadata: {
          type: this.odType as string,
          source: this.filePath
        }
      }
    }
  }
}
