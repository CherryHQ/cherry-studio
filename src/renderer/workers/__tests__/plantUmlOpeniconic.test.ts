import { renderSvg } from '@plantuml/mcp-js/engine.js'
import { instance } from '@viz-js/viz'
import { describe, expect, it } from 'vitest'

import { registerPlantUmlOpeniconic } from '../plantUmlOpeniconic'

// Same engine realm setup as the render worker.
Object.assign(globalThis, { Viz: { instance } })

type EngineResult = { valid: true; svg: string } | { valid: false; errorMessage: string }

const render = (source: string): Promise<EngineResult> =>
  new Promise((resolve) => renderSvg(source, (json: string) => resolve(JSON.parse(json))))

const countPaths = (svg: string): number => (svg.match(/<path\b/g) ?? []).length

describe('registerPlantUmlOpeniconic', () => {
  it('registers all built-in icons from the bundled map', () => {
    registerPlantUmlOpeniconic()
    const registered = (globalThis as Record<string, unknown>).PLANTUML_OPENICONIC as Record<string, string>
    expect(Object.keys(registered)).toHaveLength(223)
    expect(registered.home).toContain('<path')
  })

  it('renders built-in <&name> icons offline without fetching openiconic.js', async () => {
    registerPlantUmlOpeniconic()
    const withIcon = await render('@startuml\nAlice -> Bob: <&home> hello\n@enduml\n')
    const plain = await render('@startuml\nAlice -> Bob: hello\n@enduml\n')

    expect(withIcon.valid).toBe(true)
    expect(plain.valid).toBe(true)
    if (withIcon.valid && plain.valid) {
      // The icon contributes a path element on top of the plain diagram's arrowheads.
      expect(countPaths(withIcon.svg)).toBeGreaterThan(countPaths(plain.svg))
    }
  })

  it('renders icons whose path carries a transform attribute', async () => {
    registerPlantUmlOpeniconic()
    const result = await render('@startuml\nAlice -> Bob: <&action-redo> again\n@enduml\n')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.svg).toContain('<path')
    }
  })
})
