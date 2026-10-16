import { afterEach, describe, expect, it, vi } from 'vitest'

import { WebSearchError } from '@cherrystudio/web-search'

import { WebSearchConfigError } from '../../WebSearchConfigError'
import { executeRemoteProvider } from '../remoteWebSearchClient'

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch } }))
afterEach(() => fetch.mockReset())

const request = {
  providerId: 'tavily' as const,
  capability: 'searchKeywords' as const,
  input: 'hello',
  apiHost: 'https://search.example',
  maxResults: 1,
  credentials: { apiKey: 'secret-key' }
}

describe('Desktop remote provider error boundary', () => {
  it('retains Desktop permanent configuration errors', async () => {
    const error = await executeRemoteProvider({ ...request, apiHost: '' }).catch((error) => error)
    expect(error).toBeInstanceOf(WebSearchConfigError)
    expect(error.code).toBe('api_host_missing')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [{ maxResults: 0 }, 'invalid_max_results'],
    [{ timeoutMs: -1 }, 'invalid_timeout']
  ])('keeps invalid runtime values outside the permanent configuration class: %s', async (override, code) => {
    const error = await executeRemoteProvider({ ...request, ...override }).catch((error) => error)
    expect(error).toBeInstanceOf(WebSearchError)
    expect(error).not.toBeInstanceOf(WebSearchConfigError)
    expect(error).toMatchObject({ kind: 'configuration', code, providerId: 'tavily', capability: 'searchKeywords' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards the caller cancellation reason unchanged', async () => {
    const controller = new AbortController()
    const reason = new DOMException('caller cancelled', 'AbortError')
    controller.abort(reason)
    await expect(executeRemoteProvider({ ...request, signal: controller.signal })).rejects.toBe(reason)
    expect(fetch).not.toHaveBeenCalled()
  })
})
