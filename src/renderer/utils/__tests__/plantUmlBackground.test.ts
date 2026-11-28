import { describe, expect, it } from 'vitest'

import { applyBackgroundSkinparam } from '../plantUmlBackground'

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" style="width:104px;height:114px;background:#FFFFFF;" width="104px"><g><line stroke="#FFF"/></g></svg>'

describe('applyBackgroundSkinparam', () => {
  it('rewrites the root background when the source declares a named color', () => {
    const source = '@startuml\nskinparam backgroundColor black\nAlice -> Bob: hi\n@enduml'
    const result = applyBackgroundSkinparam(source, SVG)
    expect(result).toContain('background:black;')
    expect(result).not.toContain('background:#FFFFFF')
    expect(result).toContain('<line stroke="#FFF"/>')
  })

  it('rewrites the root background when the source declares a hex color', () => {
    const source = '@startuml\nskinparam backgroundColor #1E1E2E\nAlice -> Bob: hi\n@enduml'
    expect(applyBackgroundSkinparam(source, SVG)).toContain('background:#1E1E2E;')
  })

  it('matches the skinparam case-insensitively and tolerates leading whitespace', () => {
    const source = '@startuml\n  SKINPARAM BACKGROUNDCOLOR   darkslategray\nAlice -> Bob: hi\n@enduml'
    expect(applyBackgroundSkinparam(source, SVG)).toContain('background:darkslategray;')
  })

  it('leaves the SVG unchanged when no background skinparam is present', () => {
    const source = '@startuml\nAlice -> Bob: hi\n@enduml'
    expect(applyBackgroundSkinparam(source, SVG)).toBe(SVG)
  })

  it('leaves the SVG unchanged for values that are not simple CSS colors', () => {
    const source = '@startuml\nskinparam backgroundColor black|white\nAlice -> Bob: hi\n@enduml'
    expect(applyBackgroundSkinparam(source, SVG)).toBe(SVG)
  })

  it('leaves an SVG without a root background style unchanged', () => {
    const source = '@startuml\nskinparam backgroundColor black\nAlice -> Bob: hi\n@enduml'
    const noBackground = '<svg xmlns="http://www.w3.org/2000/svg" width="104px"><g/></svg>'
    expect(applyBackgroundSkinparam(source, noBackground)).toBe(noBackground)
  })
})
