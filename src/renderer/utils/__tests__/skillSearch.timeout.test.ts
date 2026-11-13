import { afterEach, expect, it, vi } from 'vitest'

import { loadSkillsShLeaderboard } from '../skillSearch'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('aborts a catalog response whose body stalls after successful headers', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, { signal }: RequestInit) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new DOMException('Body timed out', 'AbortError')))
        })
    }))
  )

  const outcome = loadSkillsShLeaderboard(0).then(
    () => 'resolved',
    (error: Error) => error.name
  )
  await vi.advanceTimersByTimeAsync(15_000)

  expect(await Promise.race([outcome, Promise.resolve('still pending')])).toBe('AbortError')
})
