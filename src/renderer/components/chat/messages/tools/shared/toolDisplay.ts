import type { ToolDisclosureItem } from './ToolDisclosure'

/** Live and persisted tool payloads reach display components before tool-specific decoding. */
export interface ToolDisplayProps {
  input?: unknown
  output?: unknown
  hasError?: boolean
}

export type ToolDisplayRenderer = (props: ToolDisplayProps) => ToolDisclosureItem
