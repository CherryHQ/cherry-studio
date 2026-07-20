import type { SourceMap } from 'magic-string'

export const UI_CONTRACT_VERSION = 1 as const

export interface UiNodeDescriptor {
  /** Internal source-anchor material used to reconstruct this occurrence cohort. */
  anchorCohort: string
  anchorHash: string
  component: string
  element: string
  fingerprintHash: string
  kind: 'html' | 'jsx'
  previousAnchorHash?: string
  semanticId: string
  semanticSource: 'explicit' | 'inferred'
  sourceFile: string
  sourceOffset: number
}

export interface UiNodeContract {
  id: string
  semanticId: string
}

export type UiRegistryNode = readonly [anchorHash: string, fingerprintHash: string, id: string]

export interface UiContractRegistry {
  version: typeof UI_CONTRACT_VERSION
  nodes: UiRegistryNode[]
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
