import { type Document, FileReader, type Metadata } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'

import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeCsvReader')

/** Comma first, so that it wins every tie. */
const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const

const SAMPLE_BYTES = 64 * 1024
const SAMPLE_RECORDS = 20

/**
 * Fields per record under `delimiter`, read the way a CSV parser reads: a
 * delimiter or a newline inside a quoted field belongs to the field.
 *
 * `truncated` says the sample stops mid-file, so its last record may be cut and
 * is left out rather than counted at the wrong width.
 */
function recordFieldCounts(sample: string, delimiter: string, truncated: boolean): number[] {
  const counts: number[] = []
  let fields = 1
  let quoted = false
  let blank = true

  for (let index = 0; index < sample.length && counts.length < SAMPLE_RECORDS; index++) {
    const char = sample[index]
    if (char === '"') {
      if (quoted && sample[index + 1] === '"')
        index++ // an escaped quote inside a quoted field
      else quoted = !quoted
      blank = false
    } else if (quoted) {
      blank = false
    } else if (char === delimiter) {
      fields++
      blank = false
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && sample[index + 1] === '\n') index++
      if (!blank) counts.push(fields)
      fields = 1
      blank = true
    } else {
      blank = false
    }
  }

  if (!blank && !truncated && counts.length < SAMPLE_RECORDS) counts.push(fields)
  return counts
}

/**
 * Fields per record under `delimiter`, or 0 when the records do not agree on a
 * width — a separator the file was not written with lines nothing up.
 *
 * The header's width is the width, and most records have to share it. A
 * spreadsheet export with one ragged row is ordinary, which is why the reader
 * relaxes the column count, so the detector must not reject the file over it.
 */
function dominantFieldCount(sample: string, delimiter: string, truncated: boolean): number {
  const counts = recordFieldCounts(sample, delimiter, truncated)
  const width = counts[0] ?? 0
  if (width < 2) return 0

  const matching = counts.filter((count) => count === width).length
  return matching * 2 > counts.length ? width : 0
}

/**
 * The separator `text` was written with, defaulting to a comma.
 *
 * `truncated` says `text` is only the head of a larger file, so its last
 * record may be cut in half and is left out of the counts.
 *
 * Reading a semicolon separated export with a comma does not fail: every row
 * comes back as a single field holding the whole line, separators included.
 */
export function detectDelimiter(text: string, truncated = false): string {
  const sample = text.slice(0, SAMPLE_BYTES)
  const cut = truncated || sample.length < text.length

  // A file the comma already lines up is read correctly today. Another
  // candidate can line it up too — a tag list joined with semicolons does —
  // and preferring that one would be a regression, so the comma keeps the file
  // whenever it fits.
  if (dominantFieldCount(sample, ',', cut)) return ','

  let bestDelimiter = ','
  let bestFields = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const fields = dominantFieldCount(sample, delimiter, cut)
    if (fields > bestFields) {
      bestDelimiter = delimiter
      bestFields = fields
    }
  }
  return bestDelimiter
}

/**
 * Reads a `.csv` the way the file was actually written.
 *
 * `CSVReader` is constructed before the file is read, so it cannot be told the
 * separator up front. This reader decodes the bytes first, detects the
 * separator, and only then hands the content to it.
 *
 * `relaxColumnCount` is on for the same reason the separator is detected: a
 * spreadsheet export with one ragged row is ordinary, and csv-parse rejects the
 * whole file over it (`Invalid Record Length: expect 2, got 3 on line 3`),
 * which loses every other row as well.
 */
export class CsvReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    // Only the head is decoded: the detector never looks past it, and the file
    // itself is decoded by the parser below.
    const sample = new TextDecoder('utf-8').decode(fileContent.subarray(0, SAMPLE_BYTES))
    const delimiter = detectDelimiter(sample, fileContent.length > SAMPLE_BYTES)
    logger.debug('Reading csv', { filename, delimiter })

    const reader = new CSVReader(true, ', ', '\n', {
      delimiter,
      relax_column_count: true
    })
    return reader.loadDataAsContent(fileContent)
  }
}
