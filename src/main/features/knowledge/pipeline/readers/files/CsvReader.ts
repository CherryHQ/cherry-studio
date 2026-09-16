import { type Document, FileReader, type Metadata } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'

import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeCsvReader')

/** Comma first, so that it wins every tie. */
const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const

const SAMPLE_CHARS = 64 * 1024
const SAMPLE_ROWS = 20

/** Fields in one line, ignoring delimiters inside a quoted field. */
function countFields(line: string, delimiter: string): number {
  let fields = 1
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index++ // an escaped quote inside a quoted field
        continue
      }
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      fields++
    }
  }
  return fields
}

/**
 * Fields per row under `delimiter`, or 0 when the rows disagree — a separator
 * the file was not written with does not line the rows up.
 */
function consistentFieldCount(sample: string, delimiter: string): number {
  let count = 0
  let rows = 0
  for (const line of sample.split(/\r\n|\n|\r/)) {
    if (rows >= SAMPLE_ROWS) break
    if (!line) continue // a blank line says nothing about the separator
    rows++
    const fields = countFields(line, delimiter)
    if (count && fields !== count) return 0
    count = fields
  }
  return count > 1 ? count : 0
}

/**
 * The separator `text` was written with, defaulting to a comma.
 *
 * Reading a semicolon separated export with a comma does not fail: every row
 * comes back as a single field holding the whole line, separators included.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, SAMPLE_CHARS)
  let bestDelimiter = ','
  let bestFields = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const fields = consistentFieldCount(sample, delimiter)
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
