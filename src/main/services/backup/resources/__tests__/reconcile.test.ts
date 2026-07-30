import { describe, expect, it } from 'vitest'

import type { AdmittedResource } from '../../admission/verify'
import type { BackupManifest, ResourceRequirement } from '../../manifest'
import type { ResourceInventory } from '../collectRequirements'
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
    contentPaths: ['raw/source.pdf'],
    ...overrides
  }
}

function inventory(requiredContent: ResourceInventory['requiredContent'] = new Map()): ResourceInventory {
  return {
    requirements: [REQUIRED],
    requiredContent,
    unverifiableByKind: {
      'file-blob': 0,
      'knowledge-base': 0,
      'note-root': 0,
      'agent-data': 0,
      'agent-workspace': 0,
      skill: 0,
      'mcp-workspace': 0,
      'mcp-memory': 0,
      'agent-channel-state': 0,
      'agent-runtime-config': 0,
      'agent-transcript': 0
    }
  }
}

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
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

    expect(reconcileRestoreResources(manifest(), inventory(), [resource])).toEqual([resource])
  })

  it('rejects a manifest requirement set that is not the materialized database closure', () => {
    const redirected = { ...REQUIRED, livePath: 'Data/KnowledgeBase/unrelated' }

    expect(() => reconcileRestoreResources(manifest({ resourceRequirements: [redirected] }), inventory(), [])).toThrow(
      /requirement-set/
    )
  })

  it('rejects a correctly hashed payload redirected to an unrelated managed target', () => {
    expect(() =>
      reconcileRestoreResources(manifest(), inventory(), [admitted({ livePath: 'Data/KnowledgeBase/unrelated' })])
    ).toThrow(/payload-target/)
  })

  it('rejects changing the kind while keeping the same live path', () => {
    expect(() => reconcileRestoreResources(manifest(), inventory(), [admitted({ kind: 'agent-data' })])).toThrow(
      /payload-target/
    )
  })

  it('allows a missing Full payload only with its exact resource degradation', () => {
    const degraded = manifest({
      degradations: [{ kind: 'resource:knowledge-base', livePath: REQUIRED.livePath, reason: 'absent' }]
    })

    expect(reconcileRestoreResources(degraded, inventory(), [])).toEqual([])
    expect(() => reconcileRestoreResources(manifest(), inventory(), [])).toThrow(/payload-missing/)
  })

  it('does not let a resource-entry degradation authorize a missing whole payload', () => {
    const partiallyDegraded = manifest({
      degradations: [
        {
          kind: 'resource-entry:knowledge-base',
          livePath: `${REQUIRED.livePath}/external-link`,
          reason: 'external-reference'
        }
      ]
    })

    expect(() => reconcileRestoreResources(partiallyDegraded, inventory(), [])).toThrow(/payload-missing/)
    expect(reconcileRestoreResources(partiallyDegraded, inventory(), [admitted()])).toHaveLength(1)
  })

  it('rejects duplicate declarations instead of treating a set as a multiset', () => {
    expect(() =>
      reconcileRestoreResources(manifest({ resourceRequirements: [REQUIRED, REQUIRED] }), inventory(), [])
    ).toThrow(/duplicate/)
  })

  it('requires every database-declared rebuild material path in the admitted payload', () => {
    const requiredContent = new Map([[REQUIRED.livePath, ['raw/source.pdf', 'raw/metadata.json']]])

    expect(() => reconcileRestoreResources(manifest(), inventory(requiredContent), [admitted()])).toThrow(
      /required-content/
    )
    expect(
      reconcileRestoreResources(manifest(), inventory(requiredContent), [
        admitted({ contentPaths: ['raw/source.pdf', 'raw/metadata.json'] })
      ])
    ).toHaveLength(1)
  })

  it('rejects an explicitly unsatisfiable required-content proof without exposing paths', () => {
    let thrown: unknown
    try {
      reconcileRestoreResources(manifest(), inventory(new Map([[REQUIRED.livePath, null]])), [
        admitted({ stagedPath: '/secret/archive/staging' })
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'required-content' })
    expect(String(thrown)).not.toContain('/secret/archive/staging')
  })
})
