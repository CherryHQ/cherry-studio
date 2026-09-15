import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { DoctorReport, DoctorSubjectRef } from '@shared/types/doctor'
import { doctorScopeKey } from '@shared/utils/doctor'

vi.unmock('@data/hooks/useCache')

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/hooks/useAppUpdateState', () => ({ useAppUpdateState: () => ({ appUpdateState: {} }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { useDoctorController } from '../useDoctorController'

const chat = { kind: 'chat', providerId: 'openai', modelId: 'historical-model' } as const

function report(subject: DoctorSubjectRef): DoctorReport {
  return {
    schemaVersion: 1,
    runId: `run-${subject.kind}`,
    scope: doctorScopeKey(subject),
    tier: 'quick',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    basics: {
      version: '2.0.0',
      edition: 'global',
      channel: 'latest',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '25',
      runtime: {},
      isPackaged: false,
      isPortable: false,
      userDataPath: '/tmp/doctor'
    },
    results: [
      { id: subject.kind === 'global' ? 'install-version-channel' : 'provider-model', status: 'pass', durationMs: 1 }
    ],
    summary: { pass: 1, warn: 0, fail: 0, skip: 0, error: 0 }
  }
}

beforeEach(() => {
  MockCacheUtils.resetMocks()
  request.mockReset()
  request.mockImplementation(async (_route, { subject }) => {
    const completed = report(subject)
    cacheService.setShared(`doctor.state.${completed.scope}`, { status: 'completed', report: completed })
    return { status: 'completed', report: completed }
  })
})

describe('Doctor scope ownership', () => {
  it('reopens the chat report after a global full check without replacing or rerunning it', async () => {
    const first = renderHook(() => useDoctorController({ initialPanel: 'checks', subject: chat, onNavigate: vi.fn() }))
    await waitFor(() => expect(first.result.current.viewModel.report?.runId).toBe('run-chat'))
    first.unmount()
    const global = renderHook(() =>
      useDoctorController({
        initialPanel: 'checks',
        initialRunTier: 'live',
        subject: { kind: 'global' },
        onNavigate: vi.fn()
      })
    )
    await waitFor(() => expect(global.result.current.viewModel.report?.runId).toBe('run-global'))
    const calls = request.mock.calls.length
    const reopened = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', subject: chat, onNavigate: vi.fn() })
    )
    expect(reopened.result.current.viewModel.report?.results.map(({ id }) => id)).toEqual(['provider-model'])
    expect(request).toHaveBeenCalledTimes(calls)
    await act(async () => {
      await reopened.result.current.run('live')
    })
    expect(request).toHaveBeenLastCalledWith('diagnostics.doctor.run', { tier: 'live', subject: chat })
    expect(global.result.current.viewModel.report?.scope).toBe('global')
  })

  it('does not carry a successful fix into a newer report', async () => {
    const subject = { kind: 'global' } as const
    const first = report(subject)
    cacheService.setShared('doctor.state.global', { status: 'completed', report: first })
    const { result } = renderHook(() => useDoctorController({ initialPanel: 'checks', subject, onNavigate: vi.fn() }))
    request.mockResolvedValueOnce({ status: 'fixed' })
    await act(async () => {
      await result.current.executeAction('config-boot-config-valid', { kind: 'fix', fixId: 'repair' }, first.runId)
    })
    expect(result.current.session.fixedCheckIds).toEqual(['config-boot-config-valid'])
    act(() => {
      cacheService.setShared('doctor.state.global', {
        status: 'completed',
        report: { ...first, runId: 'new-run' }
      })
    })
    expect(result.current.viewModel.runId).toBe('new-run')
    expect(result.current.session.fixedCheckIds).toEqual([])
  })

  it.each(['report', 'export'] as const)('does not start a health check when opening %s', (initialPanel) => {
    const { result } = renderHook(() =>
      useDoctorController({ initialPanel, subject: { kind: 'global' }, onNavigate: vi.fn() })
    )
    expect(result.current.isAutoRunPending).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})
