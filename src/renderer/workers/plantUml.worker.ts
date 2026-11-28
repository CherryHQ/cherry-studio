import { renderSvg } from '@plantuml/mcp-js/engine.js'
import { instance } from '@viz-js/viz'

import { splitPlantUmlPages } from '../utils/plantUmlPages'

export type PlantUmlRenderResponse = { svgs: string[] } | { error: string; line?: number }

type PlantUmlEngineResult =
  | { valid: true; svg: string }
  | { valid: false; errorMessage: string; errorLineNumber?: number }

// PlantUML looks up Viz.js in its worker realm for diagrams that need Graphviz.
Object.assign(globalThis, { Viz: { instance } })

self.onmessage = async ({ data: source }: MessageEvent<string>) => {
  let response: PlantUmlRenderResponse
  try {
    // PlantUML renders only the first page of a multi-page (`newpage`) diagram,
    // so each page is rendered separately.
    const pages = splitPlantUmlPages(source)
    const svgs: string[] = []
    for (const page of pages) {
      const json = await new Promise<string>((resolve) => renderSvg(page, resolve))
      const result: PlantUmlEngineResult = JSON.parse(json)
      if (!result.valid) {
        response = { error: result.errorMessage, line: result.errorLineNumber }
        self.postMessage(response)
        return
      }
      svgs.push(result.svg)
    }
    response = { svgs }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
