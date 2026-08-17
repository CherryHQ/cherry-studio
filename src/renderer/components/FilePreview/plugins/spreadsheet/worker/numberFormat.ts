import * as numfmt from 'numfmt'

/**
 * numfmt wrapper: renders numbers, dates, and booleans as display text using Excel number formats.
 * Date inputs are converted to Excel serials before calling numfmt. Formatting failures fall back to String(raw).
 *
 * Note 1: numfmt.format types require pattern to be a string, not optional, but both docs and runtime treat a missing
 * pattern as General. Passing numFmt ?? 'General' satisfies type checking and behaves like passing undefined.
 * Note 2: numfmt dateToSerial/dateFromSerial only implement the 1900 date system, with no public date1904 option.
 * Inputs here are always JS Date values already parsed by ExcelJS as absolute instants. ExcelJS uses
 * workbook.properties.date1904 during read to convert 1904-system source serials into the correct Date.
 * Therefore converting Date back to serial only needs the 1900-system serial for that real date so numfmt can render
 * it using its native 1900 convention. No second date1904 offset is needed. The `date1904` parameter stays in the
 * signature so callers pass the date system explicitly. If a future path passes raw date serial numbers instead of
 * Date objects, such as direct formula-engine date serial output, apply the offset on that path:
 * 1904-system serial = 1900-system serial - 1462.
 */

/** JS Date read from UTC components, matching ExcelJS Date semantics, -> 1900-system Excel serial. */
export function dateToExcelSerial(date: Date): number {
  return (
    numfmt.dateToSerial([
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    ]) ?? 0
  )
}

/** Fixed Date.prototype.toISOString() shape with milliseconds and Z; the only accepted string date path. */
const ISO_DATE_STRING_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function formatCellValue(raw: unknown, numFmt: string | undefined, date1904: boolean): string {
  const pattern = numFmt ?? 'General'
  void date1904

  if (raw === null || raw === undefined) {
    return ''
  }

  if (raw instanceof Date) {
    const serial = dateToExcelSerial(raw)
    try {
      return numfmt.format(pattern, serial, { throws: true })
    } catch {
      return String(raw)
    }
  }

  // ISO-shaped dates may arrive as strings, such as formula result backfill. parseWorkbook stores Date raw values as
  // toISOString() output. Accept only the strict shape so text cells like "1" are not rendered as dates by loose
  // Date parsing; all other strings remain plain text.
  if (typeof raw === 'string' && numFmt && numfmt.isDateFormat(numFmt) && ISO_DATE_STRING_RE.test(raw)) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) {
      const serial = dateToExcelSerial(parsed)
      try {
        return numfmt.format(pattern, serial, { throws: true })
      } catch {
        return String(raw)
      }
    }
  }

  if (typeof raw === 'boolean') {
    try {
      return numfmt.format(pattern, raw, { throws: true })
    } catch {
      return raw ? 'TRUE' : 'FALSE'
    }
  }

  if (typeof raw === 'number') {
    try {
      return numfmt.format(pattern, raw, { throws: true })
    } catch {
      return String(raw)
    }
  }

  // Strings, including General, are returned as-is. If a format is specified, still try numfmt, e.g. '@' text format.
  try {
    return numfmt.format(pattern, raw, { throws: true })
  } catch {
    return String(raw)
  }
}
