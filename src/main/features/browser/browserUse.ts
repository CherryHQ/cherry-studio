import * as z from 'zod'

export const browserRefSchema = z.string().regex(/^e[1-9]\d*$/)
export type BrowserRef = z.infer<typeof browserRefSchema>

export const snapshotOptionsSchema = z
  .object({
    full: z.boolean().optional(),
    scope: browserRefSchema.optional(),
    maxChars: z.number().int().min(256).max(40_000).optional()
  })
  .strict()
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
