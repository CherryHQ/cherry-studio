import type { SourceMap } from 'magic-string'

export const UI_CONTRACT_VERSION = 1 as const

export interface UiNodeDescriptor {
  anchorHash: string
  component: string
  element: string
  kind: 'html' | 'jsx'
  semanticId: string
  semanticSource: 'explicit' | 'inferred'
  sourceFile: string
  sourceOffset: number
}

export interface UiNodeContract {
  id: string
  semanticId: string
}

export interface UiContractManifestNode extends UiNodeDescriptor {
  id: string
}

export type UiContractPackedNode = readonly [
  id: string,
  semanticIndex: number,
  elementIndex: number,
  sourceIndex: number,
  sourceOffset: number,
  componentIndex: number,
  kind: 0 | 1
]

export interface UiContractManifest {
  columns: readonly ['id', 'semantic', 'element', 'source', 'offset', 'component', 'kind']
  components: string[]
  elements: string[]
  nodes: UiContractPackedNode[]
  semantics: string[]
  sources: string[]
  version: typeof UI_CONTRACT_VERSION
}

export interface UiSourceTransform {
  code: string
  descriptors: UiNodeDescriptor[]
  map: SourceMap | null
}
