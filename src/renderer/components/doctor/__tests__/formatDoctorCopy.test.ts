import type { DoctorReport } from '@shared/types/doctor'
import { describe, expect, it } from 'vitest'

import { formatDoctorReportForCopy } from '../formatDoctorCopy'

describe('formatDoctorReportForCopy', () => {
  it('copies only public basics, visible identity, status, and public evidence', () => {
    const report: DoctorReport = {
      schemaVersion: 1,
      runId: 'secret-run-id',
      tier: 'quick',
      startedAt: '2026-09-04T08:59:00.000Z',
      finishedAt: '2026-09-04T08:59:01.000Z',
      expiresAt: '2026-09-04T09:09:01.000Z',
      basics: {
        version: '2.0.0',
        edition: 'global',
        channel: 'latest',
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '25.0.0',
        runtime: { electron: '40.0.0', node: '24.0.0' },
        isPackaged: true,
        isPortable: false,
        userDataPath: '/Users/private/Library/Application Support/CherryStudio'
      },
      results: [
        {
          id: 'network-endpoint-cloud',
          status: 'fail',
          attribution: 'transient',
          durationMs: 123,
          devMessage: 'Authorization: Bearer private-token',
          detail: { variant: 'unreachable', params: { host: 'private.example.com' } },
          evidence: [
            { key: 'status', value: 503, dataClass: 'public' },
            { key: 'host', value: 'private.example.com', dataClass: 'local_only' },
            { key: 'body', value: 'private response', dataClass: 'consent_required' }
          ],
          actions: [{ kind: 'open_external', url: 'https://private.example.com/token' }, { kind: 'report' }]
        }
      ],
      summary: { pass: 0, warn: 0, fail: 1, skip: 0, error: 0 }
    }

    const text = formatDoctorReportForCopy(report, {
      heading: 'System diagnostics',
      basicsHeading: 'System information',
      checksHeading: 'Checks',
      basics: {
        version: 'Version',
        edition: 'Edition',
        channel: 'Channel',
        system: 'System',
        osRelease: 'OS release',
        isPackaged: 'Packaged',
        isPortable: 'Portable'
      },
      title: (id) => (id === 'network-endpoint-cloud' ? 'Cherry Cloud endpoint' : id),
      status: (status) => status.toUpperCase(),
      boolean: (value) => (value ? 'Yes' : 'No')
    })

    expect(text).toContain('2.0.0')
    expect(text).toContain('global')
    expect(text).toContain('darwin arm64')
    expect(text).toContain('Electron 40.0.0')
    expect(text).toContain('Cherry Cloud endpoint [network-endpoint-cloud]: FAIL')
    expect(text).toContain('status: 503')
    expect(text).not.toContain('secret-run-id')
    expect(text).not.toContain('/Users/private')
    expect(text).not.toContain('private-token')
    expect(text).not.toContain('private.example.com')
    expect(text).not.toContain('private response')
    expect(text).not.toContain('123')
  })
})
