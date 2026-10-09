import { describe, expect, it, vi } from 'vitest'

import { registryImageDescriptor } from '../../../__tests__/imageCatalogFixtures'
import { buildTokenhubTransport } from '../../tokenhub/tokenhubProvider'

/**
 * TokenHub image request boundary. The `/v1/wand/*` routes and request fields
 * follow https://cloud.tencent.com/document/product/1823/130080.
 * Retrieved 2026-07-27.
 */

const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }
const VIDU = registryImageDescriptor('tokenhub', 'vidu-image-q2')

describe('tokenhub transport — task query', () => {
  it('rejects missing and unknown states instead of treating them as pending', async () => {
    const transport = buildTokenhubTransport(settings, VIDU)
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')

    for (const response of [{}, { state: 'waiting' }]) {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
      try {
        await expect(
          transport.task.query('task-1', {
            signal: new AbortController().signal,
            modelDescriptor: VIDU,
            headers: undefined,
            providerParams: {}
          })
        ).rejects.toThrow(/Invalid JSON response/)
      } finally {
        fetchSpy.mockRestore()
      }
    }
  })
})
