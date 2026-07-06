/**
 * Minimal fast-formula-parser shim. The package does not ship declarations, so keep this to evaluator usage only.
 *
 * Align this with the actual runtime shape read from node_modules/fast-formula-parser@1.0.19:
 * - `index.js` is `module.exports = FormulaParser`, so the class itself is the default export.
 *   `FormulaError`/`MAX_ROW`/`MAX_COLUMN` are static properties on that class
 *   (`Object.assign(FormulaParser, { FormulaError, ... })`), not independent named exports.
 *   Therefore this shim declares `FormulaError` as a static field on `FormulaParser`. Consumers should write
 *   `FormulaParser.FormulaError`, not `import { FormulaError } from 'fast-formula-parser'`, because that named
 *   import is unreliable under plain CJS interop.
 * - The `onCell` callback receives refs shaped as `{ address, sheet, row, col }` with 1-based row/col.
 *   The library fills sheet internally, so it is never null/undefined.
 * - The `onRange` callback receives refs shaped as `{ sheet, from: {row,col}, to: {row,col} }`, and expects a
 *   row-major matrix: `result[row-from.row][col-from.col]`.
 * - For legitimate Excel error results (#DIV/0!, etc.), `parse()` returns a FormulaError instance instead of
 *   throwing. For unknown function names, syntax errors, or exceptions from onCell/onRange callbacks, it wraps the
 *   failure as FormulaError('#ERROR!', ...) and throws. See the header comment in formulaEvaluator.ts.
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
    /** Error code, such as '#DIV/0!' or '#NAME?'. */
    readonly error: string
  }

  /**
   * Single argument shape received by custom functions, wrapped internally by the library.
   * Consume it through FormulaHelpers instead of reading `.value` directly. `omitted` marks omitted args like
   * `SUM(1,,3)`.
   */
  export interface FunctionArg {
    value: unknown
    isArray?: boolean
    isRangeRef?: boolean
    isCellRef?: boolean
    omitted?: boolean
  }

  /** Types enum values from formulas/helpers.js. Only members used by custom functions are declared here. */
  export interface FormulaTypes {
    NUMBER: number
  }

  /** Minimal FormulaHelpers (H) declaration narrowed to actual custom-function usage. */
  export interface FormulaHelpersShape {
    /** Flatten all params, recursively expanding ranges/arrays/unions, and call hook for each scalar. */
    flattenParams(
      params: FunctionArg[],
      valueType: number | null,
      allowUnion: boolean,
      hook: (item: unknown, info: unknown) => void,
      defValue?: unknown,
      minSize?: number
    ): void
    /** Normalize one argument to a scalar value, parsing literals according to valueType. */
    accept(param: FunctionArg, type?: number | null, defValue?: unknown): unknown
  }

  /** Custom function signature: receives FunctionArgs, returns a scalar, and throws FormulaError for Excel errors. */
  export type ParserFunction = (...args: FunctionArg[]) => unknown

  export interface FormulaParserConfig {
    onCell?: (ref: ParserCellRef) => unknown
    onRange?: (ref: ParserRangeRef) => unknown[][]
    /** Append/override built-in functions. Merge order is after built-ins, so library stubs can be replaced. */
    functions?: Record<string, ParserFunction>
  }

  export default class FormulaParser {
    /** Static property; see file header. Do not use a named import for FormulaError. */
    static FormulaError: typeof FormulaErrorClass & {
      /** Prebuilt Excel error instances for custom functions to throw as corresponding error results. */
      DIV0: FormulaErrorClass
      NA: FormulaErrorClass
      NUM: FormulaErrorClass
      VALUE: FormulaErrorClass
    }
    /** Parameter helper set attached to the class; see index.js `...require('./formulas/helpers')`. */
    static FormulaHelpers: FormulaHelpersShape
    static Types: FormulaTypes
    constructor(config?: FormulaParserConfig)
    /** With allowReturnArray=false (default), multi-cell range/union results normalize to #VALUE!. */
    parse(formula: string, position: ParserPosition, allowReturnArray?: boolean): unknown
  }
}
