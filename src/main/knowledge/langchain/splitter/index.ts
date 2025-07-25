import { RecursiveCharacterTextSplitter, TextSplitter } from '@langchain/textsplitters'

import { YoutubeTranscriptSplitter } from './YoutubeTranscriptSplitter'

export type SplitterConfig = {
  chunkSize?: number
  chunkOverlap?: number
  type?: 'recursive' | 'youtube'
}
export class SplitterFactory {
  /**
   * Creates a TextSplitter instance based on the provided configuration.
   * @param config - The configuration object specifying the splitter type and its parameters.
   * @returns An instance of a TextSplitter, or null if no splitting is required.
   */
  public static create(config: SplitterConfig): TextSplitter {
    switch (config.type) {
      case 'youtube':
        return new YoutubeTranscriptSplitter({
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap
        })
      case 'recursive':
      default:
        return new RecursiveCharacterTextSplitter({
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap
        })
    }
  }
}
