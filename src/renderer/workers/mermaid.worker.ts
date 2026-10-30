import { renderMermaidSvg } from '@cherrystudio/ui/mermaid'
import type { MermaidRenderRequest, MermaidRenderResponse } from '@renderer/types/mermaid'

self.onmessage = async ({ data }: MessageEvent<MermaidRenderRequest>) => {
  let response: MermaidRenderResponse
  try {
    response = {
      id: data.id,
      svg: await renderMermaidSvg(data.source, { theme: data.theme, diagramId: data.diagramId })
    }
  } catch (error) {
    response = { id: data.id, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
