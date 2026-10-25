export interface DocumentTextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  font?: string
  size?: number
  color?: string
  background?: string
  link?: string
}

export interface DocumentStyle {
  align?: 'left' | 'center' | 'right' | 'justify'
  before?: number
  after?: number
  indent?: number
  background?: string
}

export interface DocumentCell {
  runs: DocumentTextRun[]
  rowSpan?: number
  colSpan?: number
  covered?: boolean
  background?: string
  borderColor?: string
  borderWidth?: number
  align?: DocumentStyle['align']
}

/** Membership that cannot be recovered from a flat block list. Item starts still use bullet. */
interface DocumentListContext {
  /** 1-based depth of the list item that contains this block. Absent outside a list. */
  listDepth?: number
  /** 1-based depth of the block's enclosing blockquote. Absent outside a quote. */
  quoteDepth?: number
  /** Present only on the block that opens a list item. */
  bullet?: number
  orderedNumber?: number
}

export type DocumentBlock =
  | ({
      type: 'heading'
      level: number
      text: string
      runs?: DocumentTextRun[]
      style?: DocumentStyle
    } & DocumentListContext)
  | ({
      type: 'text' | 'code'
      text: string
      runs?: DocumentTextRun[]
      style?: DocumentStyle
    } & DocumentListContext)
  | ({ type: 'image'; source: string; text: string; width?: number; height?: number } & DocumentListContext)
  | ({ type: 'rule' } & DocumentListContext)
  | ({
      type: 'table'
      title: string
      rows: string[][]
      cells?: DocumentCell[][]
      widths?: number[]
    } & DocumentListContext)
  | { type: 'columns'; columns: DocumentBlock[][]; widths: number[]; listDepth?: number; quoteDepth?: number }

export interface DocumentModel {
  blocks: DocumentBlock[]
  warnings: string[]
}
