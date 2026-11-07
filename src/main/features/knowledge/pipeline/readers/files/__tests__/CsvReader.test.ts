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

  it('reads a newline inside a quoted field as part of the record', () => {
    // Split on newlines alone, the quoted break makes the records disagree and
    // the file falls back to a comma it was not written with.
    const text = 'Name;Note;Units\nWidget;"first\nsecond";12\nGadget;plain;7\n'

    expect(detectDelimiter(text)).toBe(';')
  })

  it('keeps the comma when another candidate would split the rows further', () => {
    // A headerless export whose second column is a semicolon joined tag list:
    // every record is consistent under both, and the file is comma separated.
    const text = '1,red;green;blue\n2,big;small;tiny\n'

    expect(detectDelimiter(text)).toBe(',')
  })

  it('still finds the separator when one record is ragged', () => {
    // relax_column_count exists because a spreadsheet export with one ragged
    // row is ordinary; the detector must not send that file back to a comma.
    const text = 'Name;Region;Units\nWidget;EU;12\nGadget;US;7;extra\nBolt;DE;3\n'

    expect(detectDelimiter(text)).toBe(';')
  })

  it('keeps the default when no width holds for most records', () => {
    const text = 'a;b\nc;d;e\nf;g;h;i\n'

    expect(detectDelimiter(text)).toBe(',')
  })

  it('ignores the record the sample boundary cuts in half', () => {
    // The sample stops at 64 KB, so its last record is a fragment of unknown
    // width; counting it makes every separator look inconsistent.
    const cell = 'x'.repeat(4000)
    const text = `${[...Array(30).keys()].map((index) => `${index};${cell};${cell}`).join('\n')}\n`
    expect(text.length).toBeGreaterThan(64 * 1024)

    expect(detectDelimiter(text)).toBe(';')
  })
})

describe('CsvReader', () => {
  it('reads a file larger than the detection sample with the right separator', async () => {
    // Only the first 64 KB are decoded for detection, and the record the cut
    // lands in is left out of the counts.
    const cell = 'x'.repeat(4000)
    const rows = [...Array(40).keys()].map((index) => `${index};${cell};${cell}`)
    const text = `${rows.join('\n')}\n`
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(64 * 1024)

    const docs = await new CsvReader().loadDataAsContent(encode(text))

    expect(docs[0].text.split('\n')[0]).toBe(`0, ${cell}, ${cell}`)
  })

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
