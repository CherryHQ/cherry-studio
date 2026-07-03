/**
 * fast-formula-parser 未随包提供类型声明的最小 shim,按公式求值器实际使用面收紧。
 *
 * 与包的真实运行时形状对齐(源码读自 node_modules/fast-formula-parser@1.0.19):
 * - `index.js` 是 `module.exports = FormulaParser`(class 本身作为默认导出),
 *   `FormulaError`/`MAX_ROW`/`MAX_COLUMN` 等是挂在该 class 上的静态属性
 *   (`Object.assign(FormulaParser, { FormulaError, ... })`),而不是独立的具名导出。
 *   因此本 shim 把 `FormulaError` 声明为 `FormulaParser` 的 static 字段,
 *   使用方应写 `FormulaParser.FormulaError`,而不是
 *   `import { FormulaError } from 'fast-formula-parser'`(该具名导入在纯 CJS 互操作下不可靠)。
 * - `onCell` 回调收到的 ref 形状是 `{ address, sheet, row, col }`(1-based row/col,
 *   sheet 已由库内部默认填充,不会是 null/undefined)。
 * - `onRange` 回调收到的 ref 形状是 `{ sheet, from: {row,col}, to: {row,col} }`,
 *   期望返回值是行主序矩阵:`result[row-from.row][col-from.col]`。
 * - `parse()` 对"合法 Excel 错误结果"(#DIV/0! 等)是**返回**一个 FormulaError 实例
 *   (不抛出);对未知函数名、语法错误、以及 onCell/onRange 回调内部抛出的异常,
 *   则包装为 FormulaError('#ERROR!', ...) 并**抛出**。详见 formulaEvaluator.ts 头部注释。
 */
declare module 'fast-formula-parser' {
  export interface ParserPosition {
    sheet: string
    row: number
    col: number
  }

  export interface ParserCellRef extends ParserPosition {
    address: string
  }

  export interface ParserRangePoint {
    row: number
    col: number
  }

  export interface ParserRangeRef {
    sheet: string
    from: ParserRangePoint
    to: ParserRangePoint
  }

  export class FormulaErrorClass extends Error {
    constructor(error: string, message?: string, details?: unknown)
    /** 错误码,如 '#DIV/0!' '#NAME?' */
    readonly error: string
  }

  export interface FormulaParserConfig {
    onCell?: (ref: ParserCellRef) => unknown
    onRange?: (ref: ParserRangeRef) => unknown[][]
  }

  export default class FormulaParser {
    /** 静态属性,见文件头注释——不要用具名 import 取 FormulaError */
    static FormulaError: typeof FormulaErrorClass
    constructor(config?: FormulaParserConfig)
    /** allowReturnArray=false(默认)时,多格区间/联合引用结果一律归一为 #VALUE! */
    parse(formula: string, position: ParserPosition, allowReturnArray?: boolean): unknown
  }
}
