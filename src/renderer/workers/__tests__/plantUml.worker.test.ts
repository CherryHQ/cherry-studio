import { afterAll, describe, expect, it, vi } from 'vitest'

import type { PlantUmlRenderResponse } from '../plantUml.worker'

const worker = {
  onmessage: async (_event: { data: string }) => {
    void _event
  },
  postMessage: vi.fn<(response: PlantUmlRenderResponse) => void>()
}
vi.stubGlobal('self', worker)
await import('../plantUml.worker')
afterAll(() => vi.unstubAllGlobals())

describe('PlantUML worker', () => {
  it('includes the messages from each page of a sequence diagram', async () => {
    const data = '@startuml\nAlice -> Bob: First page\nnewpage\nAlice -> Bob: Second page\n@enduml'
    await worker.onmessage({ data })

    const result = worker.postMessage.mock.lastCall?.[0]
    if (!result || !('svg' in result)) throw new Error('Expected a rendered sequence diagram')
    const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml')
    expect(svg.documentElement.textContent).toContain('First page')
    expect(svg.documentElement.textContent).toContain('Second page')
  })
})
