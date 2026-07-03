import { describe, expect, it } from 'vitest'

import { formatCellValue } from '../worker/numberFormat'

describe('formatCellValue', () => {
  it('null/undefined -> empty string', () => {
    expect(formatCellValue(null, undefined, false)).toBe('')
    expect(formatCellValue(undefined, undefined, false)).toBe('')
  })

  it('General format: integer has no decimal point', () => {
    expect(formatCellValue(42, undefined, false)).toBe('42')
  })

  it('General format: string passes through unchanged', () => {
    expect(formatCellValue('hello', undefined, false)).toBe('hello')
  })

  it('General format: boolean -> TRUE/FALSE', () => {
    expect(formatCellValue(true, undefined, false)).toBe('TRUE')
    expect(formatCellValue(false, undefined, false)).toBe('FALSE')
  })

  it('General format: very large number falls back to scientific notation without throwing', () => {
    const text = formatCellValue(12345678901234, undefined, false)
    expect(text.length).toBeGreaterThan(0)
  })

  it('error-code strings pass through unaffected by numFmt', () => {
    expect(formatCellValue('#DIV/0!', '#,##0.00', false)).toBe('#DIV/0!')
  })

  it('percent format', () => {
    expect(formatCellValue(0.4567, '0.00%', false)).toBe('45.67%')
  })

  it('thousands separator + fixed decimals', () => {
    expect(formatCellValue(1234.5, '#,##0.00', false)).toBe('1,234.50')
  })

  it('date format (1900 system)', () => {
    const date = new Date(Date.UTC(2026, 0, 15))
    expect(formatCellValue(date, 'yyyy-mm-dd', false)).toBe('2026-01-15')
  })

  it('date1904 flag does not affect formatting a JS Date (ExcelJS already resolved it to an absolute instant)', () => {
    const date = new Date(Date.UTC(2026, 0, 15))
    expect(formatCellValue(date, 'yyyy-mm-dd', true)).toBe('2026-01-15')
  })

  it('date-time format preserves time-of-day fraction', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 13, 30, 0))
    expect(formatCellValue(date, 'yyyy-mm-dd hh:mm:ss', false)).toBe('2026-01-15 13:30:00')
  })

  it('invalid format string falls back to String(raw) instead of throwing', () => {
    expect(formatCellValue(123, 'bogus[[[', false)).toBe('123')
  })

  it('known Excel serial reference: 2024-01-01 is serial 45292 (1900 system)', () => {
    // Sanity-check against a widely-known Excel serial to validate the epoch handling,
    // independent of the date1904 branch.
    const date = new Date(Date.UTC(2024, 0, 1))
    expect(formatCellValue(date, '0', false)).toBe('45292')
  })
})
