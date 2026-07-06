import * as numfmt from 'numfmt'

/**
 * numfmt 包装:数字/日期/布尔 → 按 Excel 数字格式渲染的显示文本。
 * Date 输入先转 Excel serial 再交 numfmt;格式失败回退 String(raw)。
 *
 * 注 1:numfmt.format 的类型声明要求 pattern 为 string(非 optional),但其文档与运行时
 * 行为都是"缺省按 General 处理";故本文件在调用处显式传 numFmt ?? 'General' 以满足类型检查,
 * 行为与直接传 undefined 完全一致。
 * 注 2:numfmt 的 dateToSerial/dateFromSerial 只实现 1900 日期体系(无公开 date1904 选项),
 * 但这里的输入始终是 ExcelJS 已解析好的 JS Date(绝对时间点,ExcelJS 在读取阶段已经用
 * workbook.properties.date1904 把 1904 体系文件里的原始 serial 换算成了正确的 Date)。
 * 因此本函数把 Date 转回 serial 时只需算 1900 体系下这个真实日期对应的 serial(供 numfmt
 * 用它固有的 1900 约定正确渲染),不需要再对 date1904 做二次偏移——`date1904` 参数目前没有
 * 分支需要用到,保留在签名中是为了让调用方显式传递日期体系(未来若接入表示"原始 serial 数字"
 * 而非 Date 的输入路径,例如公式引擎直接产出 date serial,则应在那条路径上应用
 * 1904 体系 serial = 1900 体系 serial - 1462 的偏移)。
 */

/** JS Date(按 UTC 分量读取,与 ExcelJS 读出的 Date 语义一致)→ 1900 体系 Excel serial */
function dateToExcelSerial(date: Date): number {
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

/** Date.prototype.toISOString() 的固定形态(毫秒 + Z);字符串日期路径的唯一准入 */
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

  // ISO 字符串形态的日期(见 parseWorkbook:Date 的 raw 一律存 toISOString() 产物)在 formula
  // 结果回填等场景下可能以字符串形式传入;只认严格的 toISOString 形态,避免 "1" 这类文本单元格
  // 被 Date 构造器的宽松解析当成日期渲染,其余字符串按普通文本处理。
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

  // 字符串(含 General):原样返回;若指定了格式串仍尝试走 numfmt(如 '@' 文本格式),失败则原样。
  try {
    return numfmt.format(pattern, raw, { throws: true })
  } catch {
    return String(raw)
  }
}
