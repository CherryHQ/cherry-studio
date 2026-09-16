import { type Document, FileReader, type Metadata } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'

import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeCsvReader')

/** Comma first, so that it wins every tie. */
const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const

const SAMPLE_CHARS = 64 * 1024
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
 * Fields per record under `delimiter`, or 0 when the records disagree — a
 * separator the file was not written with does not line the records up.
 */
function consistentFieldCount(sample: string, delimiter: string, truncated: boolean): number {
  const counts = recordFieldCounts(sample, delimiter, truncated)
  if (!counts.length || counts[0] < 2) return 0
  return counts.every((count) => count === counts[0]) ? counts[0] : 0
}

/**
 * The separator `text` was written with, defaulting to a comma.
 *
 * Reading a semicolon separated export with a comma does not fail: every row
 * comes back as a single field holding the whole line, separators included.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, SAMPLE_CHARS)
  const truncated = sample.length < text.length

  // A file whose records already line up under a comma is read correctly
  // today. Another candidate can line them up too — a tag list joined with
  // semicolons does — and preferring it over the comma would be a regression,
  // so the comma keeps the file whenever it fits.
  if (consistentFieldCount(sample, ',', truncated)) return ','

  let bestDelimiter = ','
  let bestFields = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const fields = consistentFieldCount(sample, delimiter, truncated)
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
    const text = new TextDecoder('utf-8').decode(fileContent)
    const delimiter = detectDelimiter(text)
    logger.debug('Reading csv', { filename, delimiter })

    const reader = new CSVReader(true, ', ', '\n', {
      delimiter,
      relax_column_count: true
    })
    return reader.loadDataAsContent(fileContent)
  }
}
