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

  /**
   * 自定义函数收到的单个实参形状(库内部包装,见 grammar/hooks.js `_callFunction`)。
   * 用 FormulaHelpers 消费,不要直接读 `.value`。`omitted` 标记省略参数(如 `SUM(1,,3)`)。
   */
  export interface FunctionArg {
    value: unknown
    isArray?: boolean
    isRangeRef?: boolean
    isCellRef?: boolean
    omitted?: boolean
  }

  /** Types 枚举,取值见 formulas/helpers.js;这里只声明自定义函数会用到的成员 */
  export interface FormulaTypes {
    NUMBER: number
  }

  /** FormulaHelpers(H)的最小声明面,按自定义函数实际使用收紧 */
  export interface FormulaHelpersShape {
    /** 展平所有实参(区间/数组/联合递归展开),对每个标量调用 hook */
    flattenParams(
      params: FunctionArg[],
      valueType: number | null,
      allowUnion: boolean,
      hook: (item: unknown, info: unknown) => void,
      defValue?: unknown,
      minSize?: number
    ): void
    /** 将单个实参归一为标量值(按 valueType 解析字面量) */
    accept(param: FunctionArg, type?: number | null, defValue?: unknown): unknown
  }

  /** 自定义函数签名:接收若干 FunctionArg,返回标量;抛 FormulaError 表达 Excel 错误结果 */
  export type ParserFunction = (...args: FunctionArg[]) => unknown

  export interface FormulaParserConfig {
    onCell?: (ref: ParserCellRef) => unknown
    onRange?: (ref: ParserRangeRef) => unknown[][]
    /** 追加/覆盖内置函数(合并顺序在内置之后,可覆盖库内空壳函数) */
    functions?: Record<string, ParserFunction>
  }

  export default class FormulaParser {
    /** 静态属性,见文件头注释——不要用具名 import 取 FormulaError */
    static FormulaError: typeof FormulaErrorClass & {
      /** 预建的 Excel 错误实例,自定义函数抛出以表达对应错误结果 */
      DIV0: FormulaErrorClass
      NA: FormulaErrorClass
      NUM: FormulaErrorClass
      VALUE: FormulaErrorClass
    }
    /** 参数处理辅助集(挂在 class 上,见 index.js 的 `...require('./formulas/helpers')`) */
    static FormulaHelpers: FormulaHelpersShape
    static Types: FormulaTypes
    constructor(config?: FormulaParserConfig)
    /** allowReturnArray=false(默认)时,多格区间/联合引用结果一律归一为 #VALUE! */
    parse(formula: string, position: ParserPosition, allowReturnArray?: boolean): unknown
  }
}
