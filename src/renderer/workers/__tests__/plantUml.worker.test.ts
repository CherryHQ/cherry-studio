import { afterAll, describe, expect, it, vi } from 'vitest'

import type { PlantUmlRenderResponse } from '@renderer/workers/plantUml.worker'

let pendingResolve: ((response: PlantUmlRenderResponse) => void) | undefined
const host = {
  onmessage: null as ((event: MessageEvent<string>) => Promise<void> | void) | null,
  postMessage: (response: PlantUmlRenderResponse) => {
    const resolve = pendingResolve
    pendingResolve = undefined
    resolve?.(response)
  }
}

vi.stubGlobal('document', undefined)
vi.stubGlobal('self', host)
await import('../plantUml.worker')
afterAll(() => vi.unstubAllGlobals())

function renderInWorker(source: string): Promise<PlantUmlRenderResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolve = undefined
      reject(new Error('PlantUML worker did not reply within 3000ms'))
    }, 3000)
    pendingResolve = (response) => {
      clearTimeout(timer)
      resolve(response)
    }
    void host.onmessage?.(new MessageEvent('message', { data: source }))
  })
}

const c4Diagram = `@startuml
!include <C4/C4_Context>
Person(user, "User")
System(app, "Application")
Rel(user, app, "Uses")
@enduml`

describe('plantUml.worker', () => {
  it.each([
    ['', '#FFFFFF'],
    ['skinparam backgroundColor black', '#000000'],
    ['<style>\nroot {\nBackgroundColor #123456\n}\n</style>', '#123456']
  ])('renders the sequence diagram background from %j', async (setting, color) => {
    const result = await renderInWorker(
      `@startuml\n${setting}\nskinparam sequenceArrowColor white\nAlice -> Bob: Message\n@enduml`
    )

    expect(result).toEqual({ svgs: [expect.stringContaining(`background:${color};`)] })
  })

  it('fails repeated unbundled stdlib includes quickly without wedging subsequent renders', async () => {
    const first = await renderInWorker(c4Diagram)
    expect(first).toEqual({ error: 'cannot include <C4/C4_Context>', line: 2 })

    const second = await renderInWorker(c4Diagram)
    expect(second).toEqual({ error: 'cannot include <C4/C4_Context>', line: 2 })

    const sequence = await renderInWorker('@startuml\nAlice -> Bob: Hello\n@enduml')
    expect(sequence).toEqual({ svgs: [expect.stringContaining('<svg')] })
  })

  it('renders bundled themes and icons after an unbundled emoji request', async () => {
    const themed = await renderInWorker('@startuml\n!theme cerulean\nAlice -> Bob\n@enduml')
    expect(themed).toEqual({ svgs: [expect.stringContaining('<svg')] })

    const themedAgain = await renderInWorker('@startuml\n!theme cerulean\nAlice -> Bob\n@enduml')
    expect(themedAgain).toEqual({ svgs: [expect.stringContaining('<svg')] })

    const emoji = await renderInWorker('@startuml\nAlice -> Bob : <:smile:>\n@enduml')
    expect(emoji).toMatchObject({ error: expect.stringContaining('emoji.js') })

    const openiconic = await renderInWorker('@startuml\nAlice -> Bob : <&person>\n@enduml')
    expect(openiconic).toEqual({ svgs: [expect.stringContaining('<path')] })

    const graphvizClass = await renderInWorker('@startuml\nclass User {\n  +id: string\n}\n@enduml')
    expect(graphvizClass).toEqual({ svgs: [expect.stringContaining('<svg')] })
  })
})
