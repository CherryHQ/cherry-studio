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

export type DocumentBlock =
  | { type: 'heading'; level: number; text: string; runs?: DocumentTextRun[]; style?: DocumentStyle }
  | {
      type: 'text' | 'code'
      text: string
      bullet?: number
      orderedNumber?: number
      runs?: DocumentTextRun[]
      style?: DocumentStyle
    }
  | { type: 'image'; source: string; text: string; width?: number; height?: number }
  | { type: 'table'; title: string; rows: string[][]; cells?: DocumentCell[][]; widths?: number[] }
  | { type: 'columns'; columns: DocumentBlock[][]; widths: number[] }

export interface DocumentModel {
  blocks: DocumentBlock[]
  warnings: string[]
}
