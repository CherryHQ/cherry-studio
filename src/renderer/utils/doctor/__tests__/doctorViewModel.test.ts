import type { DoctorAction, DoctorCheckResult, DoctorReport, DoctorState } from '@shared/types/doctor'
import { DOCTOR_CHECK_CATALOG, DOCTOR_CHECK_IDS } from '@shared/types/doctor'
import { describe, expect, it } from 'vitest'

import { buildDoctorViewModel, defaultExpandedDoctorDomains } from '../doctorViewModel'

const NOW = Date.parse('2026-09-04T09:00:00.000Z')
const QUICK_CHECK_IDS = DOCTOR_CHECK_IDS.filter((id) => DOCTOR_CHECK_CATALOG[id].tier === 'quick')

function result(
  id: DoctorCheckResult['id'],
  status: DoctorCheckResult['status'],
  actions?: readonly DoctorAction[]
): DoctorCheckResult {
  if (status === 'pass') return { id, status, durationMs: 1 } as DoctorCheckResult
  if (status === 'skip') return { id, status, durationMs: 1, skippedBy: 'network-online' } as DoctorCheckResult
  if (status === 'error') return { id, status, durationMs: 1, message: 'private backend error' } as DoctorCheckResult
  return {
    id,
    status,
    durationMs: 1,
    attribution: 'user-fixable',
    detail: { variant: 'denied' },
    actions: actions ?? []
  } as DoctorCheckResult
}

function report(results: readonly DoctorCheckResult[], expiresAt = '2026-09-04T09:10:00.000Z'): DoctorReport {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    tier: 'quick',
    startedAt: '2026-09-04T08:59:00.000Z',
    finishedAt: '2026-09-04T08:59:01.000Z',
    expiresAt,
    basics: {
      version: '2.0.0',
      edition: 'global',
      channel: 'latest',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '25.0.0',
      runtime: {},
      isPackaged: true,
      isPortable: false
    },
    results,
    summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
  }
}

describe('buildDoctorViewModel', () => {
  it('keeps live-run rows in catalog order and marks missing results pending', () => {
    const state: DoctorState = {
      status: 'running',
      runId: 'run-1',
      tier: 'live',
      startedAt: '2026-09-04T08:59:00.000Z',
      results: [result('permission-screen-capture', 'fail'), result('install-version-channel', 'pass')]
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.rows.map((row) => row.id)).toEqual(DOCTOR_CHECK_IDS)
    expect(viewModel.rows[0]).toMatchObject({ id: 'install-version-channel', status: 'pass' })
    expect(viewModel.rows[1]).toMatchObject({ id: 'install-update-available', status: 'pending' })
    expect(viewModel.groups.find((group) => group.domain === 'permission')?.status).toBe('fail')
  })

  it('includes only quick checks while a basic run is in progress', () => {
    const state: DoctorState = {
      status: 'running',
      runId: 'run-1',
      tier: 'quick',
      startedAt: '2026-09-04T08:59:00.000Z',
      results: []
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.rows.map((row) => row.id)).toEqual(QUICK_CHECK_IDS)
    expect(viewModel.rows.every((row) => row.status === 'pending')).toBe(true)
    expect(viewModel.rows.some((row) => row.id === 'install-update-available')).toBe(false)
    expect(viewModel.canCancel).toBe(false)
  })

  it('allows cancellation only for a network and service run', () => {
    const state: DoctorState = {
      status: 'running',
      runId: 'run-1',
      tier: 'live',
      startedAt: '2026-09-04T08:59:00.000Z',
      results: []
    }

    expect(buildDoctorViewModel(state, NOW).canCancel).toBe(true)
  })

  it('never synthesizes actions for findings', () => {
    const state: DoctorState = {
      status: 'completed',
      report: report([result('permission-screen-capture', 'pass'), result('permission-accessibility', 'fail')])
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.rows[0]?.actions).toEqual([])
    expect(viewModel.rows[1]?.actions).toEqual([])
    expect(viewModel.problemCount).toBe(1)
  })

  it('marks an expired completed report stale and disables all returned actions', () => {
    const state: DoctorState = {
      status: 'completed',
      report: report(
        [result('permission-screen-capture', 'fail', [{ kind: 'fix', fixId: 'request' }])],
        '2026-09-04T08:59:59.999Z'
      )
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.isStale).toBe(true)
    expect(viewModel.rows[0]).toMatchObject({ actionsDisabled: true })
  })

  it('renders only results actually returned by a completed run', () => {
    const state: DoctorState = {
      status: 'completed',
      report: report([result('network-online', 'skip'), result('logs-recent-findings', 'error')])
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.rows.map((row) => row.id)).toEqual(['network-online', 'logs-recent-findings'])
    expect(viewModel.problemCount).toBe(0)
    expect(viewModel.summary).toMatchObject({ error: 1, skip: 1 })
  })

  it('does not mark a group as passing when one of its checks was skipped', () => {
    const state: DoctorState = {
      status: 'completed',
      report: report([result('network-online', 'pass'), result('network-dns-resolution', 'skip')])
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.groups.find((group) => group.domain === 'network')?.status).toBe('neutral')
  })

  it('normalizes completed results to catalog order and classifies every summary item once', () => {
    const state: DoctorState = {
      status: 'completed',
      report: report([
        result('logs-recent-findings', 'error'),
        result('config-hardware-acceleration', 'pass'),
        result('permission-accessibility', 'warn'),
        result('network-online', 'skip')
      ])
    }

    const viewModel = buildDoctorViewModel(state, NOW)

    expect(viewModel.rows.map((row) => row.id)).toEqual([
      'permission-accessibility',
      'config-hardware-acceleration',
      'network-online',
      'logs-recent-findings'
    ])
    expect(viewModel.summary).toEqual({
      userFixable: 1,
      appBug: 0,
      transient: 0,
      error: 1,
      skip: 1
    })
    expect(defaultExpandedDoctorDomains(viewModel.groups)).toEqual(['permission', 'network', 'logs'])
  })
})
