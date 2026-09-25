import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { listWorkflows } from '../comfyuiWorkflowDiscovery'
import { respond, stallingResponse } from './comfyuiTransport.harness'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

describe('listWorkflows', () => {
  it('passes configured headers to the userdata listing', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8188/v2/userdata?path=workflows')
      expect(init?.headers).toEqual({ 'X-Test': '1' })
      return respond([
        { name: 'a.json', type: 'file', path: 'workflows/a.json' },
        // The listing walks subdirectories: the handle must stay the relative
        // path, or reading it back from the root directory would 404.
        { name: 'nested.json', type: 'file', path: 'workflows/sub/nested.json' },
        { name: 'sub', type: 'directory', path: 'workflows/sub' },
        { name: 'notes.txt', type: 'file', path: 'workflows/notes.txt' }
      ])
    })

    const workflows = await listWorkflows('http://localhost:8188', undefined, {
      headers: { 'X-Test': '1' },
      fetch: doFetch
    })

    expect(workflows).toEqual(['a', 'sub/nested'])
  })

  it('reaches the API when the host was pasted with a trailing fragment', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://localhost:8188/v2/userdata?path=workflows')
      return respond([{ name: 'a.json', type: 'file', path: 'workflows/a.json' }])
    })

    // A fragment is never sent, so without stripping it every request lands on
    // the ComfyUI console's HTML root and the listing fails to parse.
    const workflows = await listWorkflows('http://localhost:8188/#', undefined, { fetch: doFetch })

    expect(workflows).toEqual(['a'])
  })

  it('surfaces a failed listing as a structured REMOTE_ERROR with the server message', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ message: 'server exploded' }), { status: 500 }))

    const error = await listWorkflows('http://localhost:8188', undefined, { fetch: doFetch }).catch((e) => e)

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect(error).toMatchObject({ code: 'REMOTE_ERROR', message: 'server exploded' })
  })
})

describe('a listing is bounded by its own request deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds a listing whose body never arrives', async () => {
    const doFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => stallingResponse(init))
    const promise = listWorkflows('http://localhost:8188', undefined, { fetch: doFetch }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    expect((error as Error).message).toContain('request_timeout')
  })
})
