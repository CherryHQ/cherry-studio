import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { bootConfigSchema, DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const store = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

// In-memory boot config that validates writes like the real service does.
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: (key: string) => store.values[key],
    set: (key: keyof typeof bootConfigSchema.shape, value: unknown) => {
      store.values[key] = bootConfigSchema.shape[key].parse(value)
    }
  }
}))

import {
  queuePendingReport,
  queueStagedRelocation,
  queueStagedRestore,
  restoreKeptClientId,
  settlePendingRestore,
  settleRelocation,
  takePendingReports
} from '../analyticsPendingReports'

describe('analytics pending reports', () => {
  let keptIdFile: string

  beforeEach(() => {
    store.values = { ...DefaultBootConfig }
    keptIdFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kept-id-')), 'restore-client-id')
    vi.mocked(application.getPath).mockImplementation((key) =>
      key === 'app.restore_client_id_file' ? keptIdFile : `/mock/${key}`
    )
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
  })

  it('reports a relocation the user asked for with consent, including a later abandon, once settled', () => {
    queueStagedRelocation('task-1', true)
    expect(takePendingReports()).toEqual([])

    settleRelocation('task-1', 'failed')
    settleRelocation('task-1', 'abandoned')
    expect(takePendingReports()).toEqual([
      { event: 'data_relocation_run', copy: true, status: 'failed' },
      { event: 'data_relocation_run', copy: true, status: 'abandoned' }
    ])
  })

  it('settles only the relocation it belongs to, not an older report still in the queue', () => {
    queueStagedRelocation('earlier', false)
    settleRelocation('earlier', 'completed')
    // A relocation requested with collection off stages nothing; its outcome must not attach to the older one.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    queueStagedRelocation('later', true)
    settleRelocation('later', 'failed')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)

    expect(takePendingReports()).toEqual([{ event: 'data_relocation_run', copy: false, status: 'completed' }])
  })

  it('records nothing for work done while collection is off, even once it is turned on', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    queueStagedRelocation('task-1', true)
    queueStagedRestore('file')
    settleRelocation('task-1', 'completed')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
    settlePendingRestore('completed')

    expect(takePendingReports()).toEqual([])
  })

  it('reports a staged restore only after the restore gate settles it, exactly once', () => {
    queueStagedRestore('nutstore')
    expect(takePendingReports()).toEqual([])

    settlePendingRestore('completed')
    expect(takePendingReports()).toEqual([{ event: 'restore_run', target: 'nutstore', status: 'completed' }])
    expect(takePendingReports()).toEqual([])
  })

  it('keeps a staged restore while sending the results that are ready', () => {
    queuePendingReport({ event: 'data_relocation_run', copy: false, status: 'abandoned' })
    queueStagedRestore('s3')

    expect(takePendingReports()).toEqual([{ event: 'data_relocation_run', copy: false, status: 'abandoned' }])
    settlePendingRestore('failed')
    expect(takePendingReports()).toEqual([{ event: 'restore_run', target: 's3', status: 'failed' }])
  })

  it('keeps only the most recent reports when launches never drain them', () => {
    for (let index = 0; index < 25; index++) {
      queuePendingReport({ event: 'data_relocation_run', copy: index % 2 === 0, status: 'failed' })
    }

    expect(takePendingReports()).toHaveLength(20)
  })

  it("keeps this device's client id when a restore brings in another device's", async () => {
    const deviceId = '91f06c3a-1776-4e98-a76f-18e03e1e6f96'
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', deviceId)
    queueStagedRestore('file')
    // The restore swaps in the backup's database, which carries its own id.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '2d4c1b0e-5f7a-4c3d-9e8b-1a2b3c4d5e6f')

    await restoreKeptClientId()

    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(deviceId)
    expect(fs.existsSync(keptIdFile)).toBe(false)
    expect(takePendingReports()).toEqual([])
  })

  it('stages a restore without writing the database when this device has no client id yet', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '')

    queueStagedRestore('file')

    const kept = fs.readFileSync(keptIdFile, 'utf8')
    expect(kept).toMatch(/^[0-9a-f-]{36}$/)
    // Nothing writes the id until the restore has gone through.
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe('')

    await restoreKeptClientId()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(kept)
  })
})
