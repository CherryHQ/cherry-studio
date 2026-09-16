import type * as z from 'zod'

import type { browserRefSchema, snapshotOptionsSchema } from '@main/ai/mcp/browserToolDefinitions'

export type BrowserRef = z.infer<typeof browserRefSchema>
export type SnapshotOptions = z.infer<typeof snapshotOptionsSchema>
export type TabRetention = 'temporary' | 'deliverable' | 'handoff'
export type SessionOwnership = { ownership: 'managed'; close: () => void } | { ownership: 'borrowed' }

export interface SnapshotNode {
  ref?: BrowserRef
  backendNodeId: number
  role: string
  name: string
  value?: string
  props: string[]
  depth: number
  inViewport: boolean
}

export interface BrowserSnapshot {
  documentId: string
  url: string
  title: string
  nodes: SnapshotNode[]
  omittedNodes: number
  truncated: boolean
}

export interface BrowserDialog {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
}

export interface CommandOptions {
  deadline?: number
  signal?: AbortSignal
}
