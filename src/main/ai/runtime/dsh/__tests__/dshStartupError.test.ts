import { describe, expect, it } from 'vitest'

import { mapDshStartupError } from '../DshRuntimeConnection'

const REPORTED_FAILURE = [
  'cherry-dsh-runtime: plugin tree failed to load: failed to apply loader entry include (cordis:include)',
  'TransportClosedError',
  'JSON-RPC input closed',
  'exit code: 1'
].join('\n')

describe('mapDshStartupError', () => {
  it('maps the reported cordis:include boot failure to an actionable message', () => {
    const mapped = mapDshStartupError(new Error(REPORTED_FAILURE))

    expect(mapped).toBeInstanceOf(Error)
    const message = mapped.message
    expect(message).toContain('failing entry: include (cordis:include)')
    expect(message).toContain('regenerated on retry')
    expect(message).toContain('left untouched')
    expect(message).toContain('reinstall Cherry Studio')
  })

  it('names the inner failed plugin when the tail lists it', () => {
    const mapped = mapDshStartupError(
      new Error(
        `${REPORTED_FAILURE}\ncherry-dsh-runtime: plugin(s) failed to load: cherry-bridge; Cordis startup failed`
      )
    )

    expect(mapped).toBeInstanceOf(Error)
    expect(mapped.message).toContain('failing entry: cherry-bridge')
  })

  it('keeps the transport and exit lines in the detail', () => {
    const mapped = mapDshStartupError(new Error(REPORTED_FAILURE))

    expect(mapped.message).toContain('exit code: 1')
  })

  it('is idempotent on its own output', () => {
    const once = mapDshStartupError(new Error(REPORTED_FAILURE))
    const twice = mapDshStartupError(once)

    expect(twice).toBe(once)
  })

  it('maps failures wrapped in a cause chain', () => {
    const mapped = mapDshStartupError(new Error('startup failed', { cause: new Error(REPORTED_FAILURE) }))

    expect(mapped).toBeInstanceOf(Error)
    expect(mapped.message).toContain('failing entry: include (cordis:include)')
    expect(mapped.cause).toBeDefined()
  })

  it('omits the entry clause when no entry can be parsed', () => {
    const mapped = mapDshStartupError(new Error('cherry-dsh-runtime: plugin tree failed to load'))

    expect(mapped.message).not.toContain('failing entry')
  })

  it('does not throw on a non-string message', () => {
    const error = new Error()
    ;(error as { message: unknown }).message = ['plugin tree failed to load']

    expect(() => mapDshStartupError(error)).not.toThrow()
  })

  it('redacts secrets from the detail', () => {
    const mapped = mapDshStartupError(
      new Error(
        'plugin tree failed to load: failed to apply loader entry include (cordis:include) api_key=sk-live-abc123'
      )
    )

    expect(mapped.message).not.toContain('sk-live-abc123')
  })

  it('keeps the original failure as the cause', () => {
    const original = new Error(REPORTED_FAILURE)
    const mapped = mapDshStartupError(original)

    expect(mapped.cause).toBe(original)
  })

  it('never suggests deleting user data', () => {
    const mapped = mapDshStartupError(new Error(REPORTED_FAILURE))

    expect(mapped.message.toLowerCase()).not.toContain('delete')
  })

  it('leaves live-transport errors on their own propagation path', () => {
    for (const message of [
      'notification transport died',
      'dsh bridge disconnected; runtime execution is stopping',
      'dsh connection materialization changed during startup: session-1',
      'session/open failed: unknown tool cordis:include'
    ]) {
      const original = new Error(message)
      expect(mapDshStartupError(original)).toBe(original)
    }
  })

  it('passes non-Error values through', () => {
    expect(mapDshStartupError('boom')).toBe('boom')
  })
})
