import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

import { CsvReader, detectDelimiter } from '../CsvReader'

const ROWS = ['Name;Region;Units', 'Widget;EU;12', 'Gadget;US;7']
const EXPECTED = 'Name, Region, Units\nWidget, EU, 12\nGadget, US, 7'

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function withDelimiter(delimiter: string): string {
  return ROWS.map((row) => row.replaceAll(';', delimiter)).join('\n') + '\n'
}

describe('detectDelimiter', () => {
  it.each([',', ';', '\t', '|'])('finds the separator the file was written with (%j)', (delimiter) => {
    expect(detectDelimiter(withDelimiter(delimiter))).toBe(delimiter)
  })

  it.each([
    // A separator inside a quoted field is not a separator.
    ['Name,Note\nWidget,"a; b"\nGadget,"c; d"\n'],
    // Rows that do not line up leave the default in place.
    ['Note\na; b\nc; d\n'],
    ['name,value\nAlice,1\nBob,2,extra\n'],
    ['']
  ])('falls back to a comma (%j)', (text) => {
    expect(detectDelimiter(text)).toBe(',')
  })

  it('does not split a single column header', () => {
    // csv-parse's own sniffing splits "Note" on the "t" inside it.
    expect(detectDelimiter('Note\nalpha\nbeta\n')).toBe(',')
  })
})

describe('CsvReader', () => {
  it.each([',', ';', '\t', '|'])('reads a %j separated file as columns', async (delimiter) => {
    const docs = await new CsvReader().loadDataAsContent(encode(withDelimiter(delimiter)))

    expect(docs).toHaveLength(1)
    expect(docs[0].text).toBe(EXPECTED)
  })

  it('keeps a row that carries an extra field instead of losing the file', async () => {
    // csv-parse rejects the whole file over it:
    // "Invalid Record Length: expect 2, got 3 on line 3".
    const docs = await new CsvReader().loadDataAsContent(encode('name,value\nAlice,1\nBob,2,extra\n'))

    expect(docs[0].text).toBe('name, value\nAlice, 1\nBob, 2, extra')
  })

  it('leaves a single column file as a single column', async () => {
    const docs = await new CsvReader().loadDataAsContent(encode('Note\na; b\nc; d\n'))

    expect(docs[0].text).toBe('Note\na; b\nc; d')
  })

  it('keeps a separator that sits inside a quoted field', async () => {
    const docs = await new CsvReader().loadDataAsContent(encode('Name,Note\nWidget,"a; b"\n'))

    expect(docs[0].text).toBe('Name, Note\nWidget, a; b')
  })
})
