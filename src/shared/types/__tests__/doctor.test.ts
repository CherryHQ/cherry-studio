import { describe, expect, it } from 'vitest'

import {
  DOCTOR_CHECK_CATALOG,
  type DoctorCheckId,
  doctorFixMeta,
  type DoctorReport,
  isDoctorFixRequest,
  projectDoctorReport
} from '../doctor'

describe('DOCTOR_CHECK_CATALOG', () => {
  it('has no prerequisite cycles', () => {
    const visiting = new Set<DoctorCheckId>()
    const done = new Set<DoctorCheckId>()
    const visit = (id: DoctorCheckId): void => {
      if (done.has(id)) return
      if (visiting.has(id)) throw new Error(`cycle through ${id}`)
      visiting.add(id)
      for (const dep of DOCTOR_CHECK_CATALOG[id].requires) visit(dep)
      visiting.delete(id)
      done.add(id)
    }
    for (const id of Object.keys(DOCTOR_CHECK_CATALOG) as DoctorCheckId[]) expect(() => visit(id)).not.toThrow()
  })

  it('exposes fix metadata the dialog needs before offering the button', () => {
    expect(doctorFixMeta('config-boot-config-valid', 'repair')).toEqual({
      id: 'repair',
      risk: 'low',
      reversible: true,
      relaunch: true
    })
    expect(doctorFixMeta('permission-screen-capture', 'request')).toEqual({
      id: 'request',
      risk: 'low',
      reversible: true,
      relaunch: false
    })
  })

  it('runs the API-key check only after the default model is valid', () => {
    expect(DOCTOR_CHECK_CATALOG['provider-api-key-present'].requires).toEqual(['provider-default-model'])
  })
})

describe('isDoctorFixRequest', () => {
  const valid = { runId: 'run-1', checkId: 'config-boot-config-valid', fixId: 'repair' }

  it('accepts a fix the catalog declares for that check, bound to a run', () => {
    expect(isDoctorFixRequest(valid)).toBe(true)
  })

  it('rejects a declared fix id aimed at a check that does not offer it', () => {
    expect(isDoctorFixRequest({ ...valid, checkId: 'storage-userdata-location' })).toBe(false)
  })

  it('rejects requests without a run identity, unknown checks and malformed payloads', () => {
    expect(isDoctorFixRequest({ checkId: valid.checkId, fixId: valid.fixId })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, runId: '' })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, checkId: 'nope' })).toBe(false)
    expect(isDoctorFixRequest(null)).toBe(false)
    expect(isDoctorFixRequest('config-boot-config-valid')).toBe(false)
  })
})

describe('projectDoctorReport', () => {
  const report: DoctorReport = {
    schemaVersion: 1,
    runId: 'run-1',
    tier: 'quick',
    startedAt: '2026-09-04T00:00:00.000Z',
    finishedAt: '2026-09-04T00:00:01.000Z',
    expiresAt: '2026-09-04T00:10:01.000Z',
    basics: {
      version: '2.0.0',
      edition: 'global',
      channel: 'latest',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '25.5.0',
      runtime: { electron: '41.8.0' },
      isPackaged: true,
      isPortable: false,
      userDataPath: '/Users/alice/Library/Application Support/CherryStudio'
    },
    results: [
      {
        id: 'storage-userdata-location',
        status: 'warn',
        attribution: 'user-fixable',
        detail: { variant: 'fallback_to_default' },
        actions: [],
        durationMs: 1,
        evidence: [
          { key: 'errno', value: 'EACCES', dataClass: 'public' },
          { key: 'path', value: '/Users/alice/...', dataClass: 'local_only' },
          { key: 'stderr', value: 'raw output', dataClass: 'consent_required' }
        ]
      }
    ],
    summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 0 }
  }
  const classes = (view: Parameters<typeof projectDoctorReport>[1], consent = false) =>
    projectDoctorReport(report, view, { consentToSensitive: consent }).results[0].evidence?.map((e) => e.dataClass)

  it('keeps only public data in the copy view, even with consent', () => {
    const copy = projectDoctorReport(report, 'copy', { consentToSensitive: true })
    expect(copy.basics.userDataPath).toBeUndefined()
    expect(classes('copy', true)).toEqual(['public'])
  })

  it('keeps local-only data in export and adds consent-required only on opt-in', () => {
    expect(projectDoctorReport(report, 'export').basics.userDataPath).toBeDefined()
    expect(classes('export')).toEqual(['public', 'local_only'])
    expect(classes('export', true)).toEqual(['public', 'local_only', 'consent_required'])
  })

  it('strips local paths from upload but honours consent for sensitive items', () => {
    expect(projectDoctorReport(report, 'upload', { consentToSensitive: true }).basics.userDataPath).toBeUndefined()
    expect(classes('upload', true)).toEqual(['public', 'consent_required'])
  })

  it('shows everything locally', () => {
    expect(classes('display')).toEqual(['public', 'local_only', 'consent_required'])
  })
})
