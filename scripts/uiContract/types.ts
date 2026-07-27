import type { SourceMap } from 'magic-string'

export interface UiNodeDescriptor {
  component: string
  element: string
  kind: 'html' | 'jsx'
  parts: string[]
  semanticId: string
  semanticSource: 'explicit' | 'inferred'
  sourceFile: string
  sourceOffset: number
}

export interface UiSourceTransform {
  code: string
  descriptors: UiNodeDescriptor[]
  map: SourceMap | null
}
