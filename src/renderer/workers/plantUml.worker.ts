import { renderSvg } from '@plantuml/mcp-js/engine.js'
import { instance } from '@viz-js/viz'

export type PlantUmlRenderResponse = { svg: string } | { error: string; line?: number }

type PlantUmlEngineResult =
  | { valid: true; svg: string }
  | { valid: false; errorMessage: string; errorLineNumber?: number }

// PlantUML looks up Viz.js in its worker realm for diagrams that need Graphviz.
Object.assign(globalThis, { Viz: { instance } })

self.onmessage = async ({ data: source }: MessageEvent<string>) => {
  let response: PlantUmlRenderResponse
  try {
    const json = await new Promise<string>((resolve) => renderSvg(source, resolve))
    const result: PlantUmlEngineResult = JSON.parse(json)
    response = result.valid ? { svg: result.svg } : { error: result.errorMessage, line: result.errorLineNumber }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
