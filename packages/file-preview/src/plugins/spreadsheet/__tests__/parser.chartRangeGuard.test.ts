import { describe, expect, it } from 'vitest'

import { readRangeFromValueTable } from '../worker/parseWorkbook'

/**
 * Guards the chart reference backfill path: chart XML references are untrusted, so an oversized range must throw
 * (chartXmlParser's safeReadRange catch then treats it as missing data) instead of materializing a huge array.
 */
describe('readRangeFromValueTable — chart reference range guard', () => {
  it('reads a bounded range as a 2D array, mapping booleans to 1/0 and empty cells to null', () => {
    const table = new Map<string, string | number | boolean | null>([
      ['Sheet1!1:1', 'A'],
      ['Sheet1!1:2', 10],
      ['Sheet1!2:1', true],
      ['Sheet1!2:2', false]
    ])

    expect(readRangeFromValueTable(table, 'Sheet1', 'A1:B2')).toEqual([
      ['A', 10],
      [1, 0]
    ])
  })

  it('resolves the sheet prefix from the reference, falling back to the passed sheet otherwise', () => {
    const table = new Map<string, string | number | boolean | null>([['Data!1:1', 'x']])

    expect(readRangeFromValueTable(table, 'Sheet1', 'Data!$A$1')).toEqual([['x']])
    expect(readRangeFromValueTable(table, 'Data', '$A$1')).toEqual([['x']])
  })

  it('unescapes doubled apostrophes in a quoted sheet name so the lookup matches the stored sheet', () => {
    // A reference like `'Bob''s Data'!$A$1` must resolve to the sheet named `Bob's Data`, not `Bob''s Data`.
    const table = new Map<string, string | number | boolean | null>([["Bob's Data!1:1", 42]])

    expect(readRangeFromValueTable(table, 'Sheet1', "'Bob''s Data'!$A$1")).toEqual([[42]])
  })

  it('returns null for an unparseable reference', () => {
    expect(readRangeFromValueTable(new Map(), 'Sheet1', 'not-a-range')).toBeNull()
  })

  it('throws for a range that exceeds the cell cap instead of materializing it', () => {
    const table = new Map<string, string | number | boolean | null>()

    // A1:XFD1048576 is the full Excel grid (~17 billion cells): must reject by area before reading any cell.
    expect(() => readRangeFromValueTable(table, 'Sheet1', 'Sheet1!$A$1:$XFD$1048576')).toThrow(/exceeds/)
    // A bounded-but-large range under the cap still evaluates.
    expect(readRangeFromValueTable(table, 'Sheet1', 'A1:A100')).toHaveLength(100)
  })
})
