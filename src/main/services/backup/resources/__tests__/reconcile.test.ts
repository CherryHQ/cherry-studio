import { describe, expect, it } from 'vitest'

import type { AdmittedResource } from '../../admission/verify'
import type { BackupManifest, ResourceRequirement } from '../../manifest'
import { reconcileRestoreResources } from '../reconcile'

const REQUIRED: ResourceRequirement = {
  kind: 'knowledge-base',
  resourceType: 'directory',
  livePath: 'Data/KnowledgeBase/kb-1'
}

function admitted(overrides: Partial<AdmittedResource> = {}): AdmittedResource {
  return {
    kind: REQUIRED.kind,
    resourceType: REQUIRED.resourceType,
    livePath: REQUIRED.livePath,
    stagedPath: '/owned/resources/Data/KnowledgeBase/kb-1',
    sizeBytes: 1,
    hash: 'a'.repeat(64),
    ...overrides
  }
}

function manifest(overrides: Partial<Extract<BackupManifest, { preset: 'full' }>> = {}): BackupManifest {
  return {
    backupFormatVersion: 2,
    createdAt: '2026-07-28T00:00:00.000Z',
    producer: { appVersion: '2.0.0', platform: 'darwin', managedRoots: [] },
    migrationChain: [{ folderMillis: 1, hash: 'migration' }],
    db: { hash: 'b'.repeat(64), sizeBytes: 1 },
    resourceRequirements: [REQUIRED],
    degradations: [],
    preset: 'full',
    resourcePayloads: [],
    ...overrides
  }
}

describe('reconcileRestoreResources', () => {
  it('accepts a payload whose kind, type, and target exactly match the materialized database', () => {
    const resource = admitted()

    expect(reconcileRestoreResources(manifest(), [REQUIRED], [resource])).toEqual([resource])
  })

  it('rejects a manifest requirement set that is not the materialized database closure', () => {
    const redirected = { ...REQUIRED, livePath: 'Data/KnowledgeBase/unrelated' }

    expect(() => reconcileRestoreResources(manifest({ resourceRequirements: [redirected] }), [REQUIRED], [])).toThrow(
      /requirement-set/
    )
  })

  it('rejects a correctly hashed payload redirected to an unrelated managed target', () => {
    expect(() =>
      reconcileRestoreResources(manifest(), [REQUIRED], [admitted({ livePath: 'Data/KnowledgeBase/unrelated' })])
    ).toThrow(/payload-target/)
  })

  it('rejects changing the kind while keeping the same live path', () => {
    expect(() => reconcileRestoreResources(manifest(), [REQUIRED], [admitted({ kind: 'agent-data' })])).toThrow(
      /payload-target/
    )
  })

  it('allows a missing Full payload only with its exact resource degradation', () => {
    const degraded = manifest({
      degradations: [{ kind: 'resource:knowledge-base', livePath: REQUIRED.livePath, reason: 'absent' }]
    })

    expect(reconcileRestoreResources(degraded, [REQUIRED], [])).toEqual([])
    expect(() => reconcileRestoreResources(manifest(), [REQUIRED], [])).toThrow(/payload-missing/)
  })

  it('rejects duplicate declarations instead of treating a set as a multiset', () => {
    expect(() =>
      reconcileRestoreResources(manifest({ resourceRequirements: [REQUIRED, REQUIRED] }), [REQUIRED], [])
    ).toThrow(/duplicate/)
  })
})
