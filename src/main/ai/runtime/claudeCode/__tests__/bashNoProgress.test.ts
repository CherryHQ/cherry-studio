import { describe, expect, it } from 'vitest'

import {
  BASH_NO_PROGRESS_THRESHOLD,
  bashNoProgressRunLength,
  type BashOutcome,
  fingerprintBashOutput,
  normalizeBashCommand
} from '../bashNoProgress'

const outcome = (command: string, fingerprint: string): BashOutcome => ({ command, fingerprint })

describe('normalizeBashCommand', () => {
  it('trims and collapses whitespace so formatting variants count as the same command', () => {
    expect(normalizeBashCommand('  curl   -s  http://x  \n')).toBe('curl -s http://x')
  })
})

describe('fingerprintBashOutput', () => {
  it('is deterministic for identical output', () => {
    expect(fingerprintBashOutput('ready', false)).toBe(fingerprintBashOutput('ready', false))
    expect(fingerprintBashOutput({ stdout: 'a', returnCode: 0 }, false)).toBe(
      fingerprintBashOutput({ stdout: 'a', returnCode: 0 }, false)
    )
  })

  it('never collides between success and failure, so a fixed-after-flaky run reads as progress', () => {
    expect(fingerprintBashOutput('boom', false)).not.toBe(fingerprintBashOutput('boom', true))
  })
})

describe('bashNoProgressRunLength', () => {
  it('ignores runs shorter than the threshold', () => {
    const history = [outcome('curl x', 'ok:a'), outcome('curl x', 'ok:a')]
    expect(bashNoProgressRunLength(history, 'curl x')).toBeUndefined()
    expect(bashNoProgressRunLength([], 'curl x')).toBeUndefined()
  })

  it('reports the trailing run once identical output repeats past the threshold', () => {
    const history = [outcome('curl x', 'ok:a'), outcome('curl x', 'ok:a'), outcome('curl x', 'ok:a')]
    expect(bashNoProgressRunLength(history, 'curl x')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('treats any output change as progress and clears the signal', () => {
    const history = [outcome('curl x', 'ok:a'), outcome('curl x', 'ok:b'), outcome('curl x', 'ok:a')]
    expect(bashNoProgressRunLength(history, 'curl x')).toBeUndefined()
  })

  it('is broken by an interleaved different command', () => {
    const history = [outcome('curl x', 'ok:a'), outcome('ls', 'ok:a'), outcome('curl x', 'ok:a')]
    expect(bashNoProgressRunLength(history, 'curl x')).toBeUndefined()
  })

  it('catches failure loops the same way — an unchanged error is also no progress', () => {
    const history = [outcome('curl x', 'err:e'), outcome('curl x', 'err:e'), outcome('curl x', 'err:e')]
    expect(bashNoProgressRunLength(history, 'curl x')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('matches whitespace variants of the incoming command', () => {
    const history = [outcome('curl -s x', 'ok:a'), outcome('curl -s x', 'ok:a'), outcome('curl -s x', 'ok:a')]
    expect(bashNoProgressRunLength(history, '  curl   -s x ')).toBe(BASH_NO_PROGRESS_THRESHOLD)
  })

  it('ignores empty commands', () => {
    const history = [outcome('curl x', 'ok:a'), outcome('curl x', 'ok:a'), outcome('curl x', 'ok:a')]
    expect(bashNoProgressRunLength(history, '   ')).toBeUndefined()
  })
})
