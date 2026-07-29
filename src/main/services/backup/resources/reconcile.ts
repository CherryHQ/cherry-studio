import type { AdmittedResource } from '../admission/verify'
import { ArchiveAdmissionError } from '../errors'
import type { BackupManifest, ResourceRequirement } from '../manifest'

/**
 * Bind an untrusted archive's resource declarations to the authoritative
 * closure recomputed from its already-materialized database.
 *
 * Admission proves that payload bytes match the manifest. This boundary proves
 * that the manifest was allowed to name those destinations at all. Keeping the
 * two proofs separate prevents a perfectly hashed hostile payload from
 * redirecting a resource kind onto unrelated managed data.
 */
export class ResourceAuthorityError extends ArchiveAdmissionError {
  readonly code: string

  constructor(code: string, detail: string) {
    super('manifest-invalid', `resource authority mismatch (${code}): ${detail}`)
    this.name = 'ResourceAuthorityError'
    this.code = code
  }
}

function identity(resource: Pick<ResourceRequirement, 'kind' | 'resourceType' | 'livePath'>): string {
  return JSON.stringify([resource.kind, resource.resourceType, resource.livePath])
}

function degradationIdentity(kind: string, livePath: string): string {
  return JSON.stringify([kind, livePath])
}

function uniqueIdentities(
  resources: readonly Pick<ResourceRequirement, 'kind' | 'resourceType' | 'livePath'>[],
  label: string
): Set<string> {
  const identities = new Set<string>()
  for (const resource of resources) {
    const key = identity(resource)
    if (identities.has(key)) {
      throw new ResourceAuthorityError('duplicate', `${label} repeats one resource identity`)
    }
    identities.add(key)
  }
  return identities
}

/**
 * Require exact requirement-set agreement and return only payloads authorized
 * by that set. An archive may omit a requirement only when the producer recorded
 * the corresponding resource degradation.
 */
export function reconcileRestoreResources(
  manifest: BackupManifest,
  authoritative: readonly ResourceRequirement[],
  admitted: readonly AdmittedResource[]
): readonly AdmittedResource[] {
  const expected = uniqueIdentities(authoritative, 'materialized database')
  const declared = uniqueIdentities(manifest.resourceRequirements, 'manifest requirements')

  if (expected.size !== declared.size || [...expected].some((key) => !declared.has(key))) {
    throw new ResourceAuthorityError(
      'requirement-set',
      `manifest declares ${declared.size} requirements; materialized database requires ${expected.size}`
    )
  }

  const payloads = uniqueIdentities(admitted, 'admitted payloads')
  for (const resource of admitted) {
    if (!expected.has(identity(resource))) {
      throw new ResourceAuthorityError(
        'payload-target',
        'an admitted payload is not required by the materialized database'
      )
    }
  }

  const degraded = new Set(
    manifest.degradations
      .filter((entry) => entry.livePath !== undefined && entry.kind.startsWith('resource:'))
      .map((entry) => degradationIdentity(entry.kind, entry.livePath!))
  )
  for (const requirement of authoritative) {
    if (payloads.has(identity(requirement))) continue
    if (!degraded.has(degradationIdentity(`resource:${requirement.kind}`, requirement.livePath))) {
      throw new ResourceAuthorityError('payload-missing', 'a required resource has neither payload nor degradation')
    }
  }

  return admitted
}
