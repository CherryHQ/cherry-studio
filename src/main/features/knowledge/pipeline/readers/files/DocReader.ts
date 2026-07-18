import { Document, FileReader, type Metadata } from '@vectorstores/core'
import WordExtractor from 'word-extractor'

/**
 * Reader for legacy binary Word documents (`.doc`, OLE2 compound format).
 *
 * `@vectorstores/readers/docx` (mammoth) only understands the OOXML `.docx` zip
 * format; feeding it — or the default `TextFileReader` — a binary `.doc` yields
 * mojibake. `word-extractor` decodes the OLE2 stream to text, matching the
 * `.doc` handling in `attachmentTextExtraction.ts`.
 */
export class DocReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array): Promise<Document<Metadata>[]> {
    const extracted = await new WordExtractor().extract(Buffer.from(fileContent))
    const text = extracted.getBody().trim()

    return text ? [new Document({ text })] : []
  }
}
