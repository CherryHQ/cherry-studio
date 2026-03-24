import type { Config } from 'svgo'

export type CustomPlugin = NonNullable<Config['plugins']>[number]

/**
 * Svgo AST node types, mirrored from svgo/lib/types.
 * We define them here because svgo does not export them via its public API.
 */

export type XastElement = {
  type: 'element'
  name: string
  attributes: Record<string, string>
  children: XastChild[]
}

export type XastText = {
  type: 'text'
  value: string
}

export type XastChild =
  | { type: 'doctype'; name: string; data: { doctype: string } }
  | { type: 'instruction'; name: string; value: string }
  | { type: 'comment'; value: string }
  | { type: 'cdata'; value: string }
  | XastText
  | XastElement

export type XastRoot = {
  type: 'root'
  children: XastChild[]
}

export type XastParent = XastRoot | XastElement
