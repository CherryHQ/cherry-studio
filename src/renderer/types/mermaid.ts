import type { MermaidTheme } from '@cherrystudio/ui/mermaid'

/** One render, posted to `mermaid.worker`. */
export interface MermaidRenderRequest {
  id: number
  source: string
  theme: MermaidTheme
  diagramId: string
}

export type MermaidRenderResponse = { id: number; svg: string } | { id: number; error: string }
