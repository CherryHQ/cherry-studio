import { renderSvg } from '@plantuml/mcp-js/engine.js'
import { instance } from '@viz-js/viz'

export type PlantUmlRenderResponse = { svg: string } | { error: string; line?: number }

type PlantUmlEngineResult =
  | { valid: true; diagramType: string; svg: string }
  | { valid: false; errorMessage: string; errorLineNumber?: number }

// PlantUML looks up Viz.js in its worker realm for diagrams that need Graphviz.
Object.assign(globalThis, { Viz: { instance } })

async function render(source: string): Promise<PlantUmlEngineResult> {
  const json = await new Promise<string>((resolve) => renderSvg(source, resolve))
  return JSON.parse(json)
}

self.onmessage = async ({ data: source }: MessageEvent<string>) => {
  let response: PlantUmlRenderResponse
  try {
    let result = await render(source)
    if (result.valid && result.diagramType === 'SequenceDiagram' && /^[\t ]*newpage(?:\s|$)/im.test(source)) {
      // The headless API exports one SVG. Let PlantUML lay out the sequence continuously.
      const continuous = await render(source.replace(/^(@startuml[^\r\n]*\r?\n)/i, '$1ignore newpage\n'))
      if (continuous.valid) result = continuous
    }
    response = result.valid ? { svg: result.svg } : { error: result.errorMessage, line: result.errorLineNumber }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
