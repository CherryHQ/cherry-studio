import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

import { probeOpenMineru } from '../protocol'

const connection = { apiHost: 'http://127.0.0.1:8000', apiKey: 'secret' }
const health = { status: 'ok', version: '4.0.6', features: { sources: ['file_id'], output_formats: ['markdown'] } }

beforeEach(() => fetchMock.mockReset())

describe('Open MinerU protocol detection', () => {
  it('recognizes V1 without calling the legacy endpoint', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(health))
    expect(await probeOpenMineru(connection)).toEqual({ kind: 'supported', protocol: 'v1' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${connection.apiHost}/v1/health`])
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer secret')
  })

  it('recognizes legacy only after V1 returns 404 and the legacy health response is valid', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'healthy', version: '3.4.5' }))
    expect(await probeOpenMineru(connection)).toEqual({ kind: 'supported', protocol: 'legacy' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${connection.apiHost}/v1/health`,
      `${connection.apiHost}/health`
    ])
  })

  it.each([401, 403, 500, 503])('does not downgrade on HTTP %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    expect(await probeOpenMineru(connection)).toEqual({ kind: 'http-error', status })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['<html>proxy login</html>', JSON.stringify({ status: 'ok' })])(
    'rejects an unrelated successful response',
    async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(body))
      expect(await probeOpenMineru(connection)).toEqual({ kind: 'invalid-response' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('does not downgrade on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(await probeOpenMineru(connection)).toEqual({ kind: 'unreachable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation instead of treating it as an unreachable deployment', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(probeOpenMineru(connection, controller.signal)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
