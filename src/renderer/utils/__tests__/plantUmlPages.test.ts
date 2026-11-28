import { describe, expect, it } from 'vitest'

import { splitPlantUmlPages } from '../plantUmlPages'

describe('splitPlantUmlPages', () => {
  it('returns a single-page source unchanged', () => {
    const source = '@startuml\nAlice -> Bob: Hello\n@enduml'
    expect(splitPlantUmlPages(source)).toEqual([source])
  })

  it('returns sources without an @start/@end wrapper unchanged', () => {
    const source = 'Alice -> Bob: Hello\nnewpage\nAlice -> Bob: Again'
    expect(splitPlantUmlPages(source)).toEqual([source])
  })

  it('splits a multi-page sequence diagram into one source per page', () => {
    const source = '@startuml\nAlice -> Bob: First page\nnewpage\nAlice -> Bob: Second page\n@enduml'
    expect(splitPlantUmlPages(source)).toEqual([
      '@startuml\nAlice -> Bob: First page\n@enduml',
      '@startuml\nAlice -> Bob: Second page\n@enduml'
    ])
  })

  it('keeps every page when there are multiple newpage separators', () => {
    const source = '@startuml\nA\nnewpage\nB\nnewpage\nC\n@enduml'
    expect(splitPlantUmlPages(source)).toEqual([
      '@startuml\nA\n@enduml',
      '@startuml\nB\n@enduml',
      '@startuml\nC\n@enduml'
    ])
  })

  it('matches newpage case-insensitively and ignores a trailing page title', () => {
    const source = '@startuml\nA\nNEWPAGE Second page\nB\n@enduml'
    expect(splitPlantUmlPages(source)).toEqual(['@startuml\nA\n@enduml', '@startuml\nB\n@enduml'])
  })

  it('drops empty pages from consecutive or trailing separators', () => {
    const source = '@startuml\nA\nnewpage\nnewpage\n@enduml'
    expect(splitPlantUmlPages(source)).toEqual(['@startuml\nA\n@enduml'])
  })

  it('preserves arguments on the @start directive', () => {
    const source = '@startuml my-diagram\nA\nnewpage\nB\n@enduml'
    expect(splitPlantUmlPages(source)).toEqual(['@startuml my-diagram\nA\n@enduml', '@startuml my-diagram\nB\n@enduml'])
  })
})
