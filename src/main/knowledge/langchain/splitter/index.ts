import { RecursiveCharacterTextSplitter, TextSplitter } from '@langchain/textsplitters'

import { SrtSplitter } from './SrtSplitter'

export type SplitterConfig = {
  chunkSize?: number
  chunkOverlap?: number
  type?: 'recursive' | 'srt' | string
}
export class SplitterFactory {
  /**
   * Creates a TextSplitter instance based on the provided configuration.
   * @param config - The configuration object specifying the splitter type and its parameters.
   * @returns An instance of a TextSplitter, or null if no splitting is required.
   */
  public static create(config: SplitterConfig): TextSplitter {
    switch (config.type) {
      case 'srt':
        return new SrtSplitter({
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
