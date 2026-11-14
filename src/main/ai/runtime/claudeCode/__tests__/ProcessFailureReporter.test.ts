import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createClaudeCodeProcessDiagnostics,
  recordClaudeCodeProcessExit,
  recordClaudeCodeSpawnError
} from '../processExitDiagnostics'
import { ProcessFailureReporter } from '../ProcessFailureReporter'

const make = () => {
  const diagnostics = createClaudeCodeProcessDiagnostics('failure-ref')
  const emit = vi.fn()
  const reporter = new ProcessFailureReporter(diagnostics, emit)
  return { diagnostics, emit, reporter }
}
afterEach(() => vi.useRealTimers())

describe('task-owned process failure reporting', () => {
  it.each([1, 139])('reports exit %s without any SDK transport failure', (code) => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    recordClaudeCodeProcessExit(diagnostics, code, null, 'native library unavailable')
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0]).toMatchObject({
      name: 'ClaudeCodeProcessExitError',
      processExitCode: code,
      processExitDetail: 'native library unavailable'
    })
    reporter.close()
  })

  it('reports a signal and merges a later source closure', async () => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    recordClaudeCodeProcessExit(diagnostics, null, 'SIGSEGV', 'segmentation fault')
    await reporter.sourceClosed(new Error('unrelated transport wording'), false)
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0]).toMatchObject({ processExitSignal: 'SIGSEGV' })
    reporter.close()
  })

  it('uses the actual process result when source closure arrives before the stderr drain', async () => {
    vi.useFakeTimers()
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    const ending = reporter.sourceClosed(new Error('opaque SDK failure'), false)
    await vi.advanceTimersByTimeAsync(100)
    recordClaudeCodeProcessExit(diagnostics, 2, null, 'native failed')
    await ending
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0]).toMatchObject({ processExitCode: 2, processExitDetail: 'native failed' })
    reporter.close()
  })

  it('leaves unrelated failures unattributed after the bounded drain grace', async () => {
    vi.useFakeTimers()
    const { emit, reporter } = make()
    reporter.beginTurn()
    const error = new Error('SDK transport closed')
    const ending = reporter.sourceClosed(error, false)
    await vi.advanceTimersByTimeAsync(250)
    await ending
    expect(emit).toHaveBeenCalledExactlyOnceWith(error)
    reporter.close()
  })

  it('does not turn a clean process exit into a failure', () => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    recordClaudeCodeProcessExit(diagnostics, 0, null, '')
    expect(emit).not.toHaveBeenCalled()
    reporter.close()
  })

  it('reports synchronous spawn failure once', () => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    recordClaudeCodeSpawnError(diagnostics, new Error('spawn ENOENT'))
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0]).toMatchObject({ processExitDetail: 'spawn ENOENT' })
    reporter.close()
  })

  it('keeps prewarm and idle failures private and rejects reuse with the actual result', async () => {
    const { diagnostics, emit, reporter } = make()
    recordClaudeCodeProcessExit(diagnostics, 1, null, 'prewarm failed')
    await reporter.sourceClosed(new Error('closed'), false)
    expect(emit).not.toHaveBeenCalled()
    expect(() => reporter.beginTurn()).toThrow('exited with code 1')
    reporter.close()
  })

  it('does not report termination during user close', async () => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    reporter.close()
    recordClaudeCodeProcessExit(diagnostics, null, 'SIGTERM', '')
    await reporter.sourceClosed(new Error('closed'), false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('preserves the abortion fallback without reporting later cancellation exit', async () => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    const fallback = vi.fn()
    await reporter.sourceClosed(new Error('aborted'), true, fallback)
    recordClaudeCodeProcessExit(diagnostics, null, 'SIGINT', '')
    expect(fallback).toHaveBeenCalledOnce()
    expect(emit).not.toHaveBeenCalled()
    reporter.close()
  })

  it('does not report an idle process exit after turn completion', () => {
    const { diagnostics, emit, reporter } = make()
    reporter.beginTurn()
    reporter.completeTurn()
    recordClaudeCodeProcessExit(diagnostics, 1, null, 'idle failed')
    expect(emit).not.toHaveBeenCalled()
    expect(() => reporter.beginTurn()).toThrow('exited with code 1')
    reporter.close()
  })
})

it('keeps the primary turn active when a steer submission is refused', () => {
  const { diagnostics, emit, reporter } = make()
  reporter.beginTurn()
  const refuseSteer = reporter.beginTurn()
  refuseSteer()
  recordClaudeCodeProcessExit(diagnostics, 1, null, 'primary failure')
  expect(emit).toHaveBeenCalledOnce()
  reporter.close()
})

it('reports a process failure during an accepted idle steer', () => {
  const { diagnostics, emit, reporter } = make()
  reporter.beginTurn()
  reporter.completeTurn()
  reporter.beginTurn()
  recordClaudeCodeProcessExit(diagnostics, 1, null, 'steer failure')
  expect(emit).toHaveBeenCalledOnce()
  reporter.close()
})

it('does not revive a completed primary when a late steer rejection arrives', () => {
  const { diagnostics, emit, reporter } = make()
  reporter.beginTurn()
  const refuseSteer = reporter.beginTurn()
  reporter.completeTurn()
  refuseSteer()
  recordClaudeCodeProcessExit(diagnostics, 1, null, 'idle failure')
  expect(emit).not.toHaveBeenCalled()
  reporter.close()
})

it('keeps a refused idle submission inactive', () => {
  const { diagnostics, emit, reporter } = make()
  const refuseSubmission = reporter.beginTurn()
  refuseSubmission()
  recordClaudeCodeProcessExit(diagnostics, 1, null, 'idle failure')
  expect(emit).not.toHaveBeenCalled()
  reporter.close()
})
