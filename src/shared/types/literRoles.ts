import * as z from 'zod'

import {
  literResolvedModelIdentityKey,
  literResolvedModelIdentitySchema,
  literServedAliasIdentitySchema,
  type LiterResolvedModelIdentity,
  type LiterServedAliasIdentity
} from './literGateway'

export const literRoleSchema = z.enum(['critic', 'judge', 'backup'])
export type LiterRole = z.infer<typeof literRoleSchema>

export const literRoleAssignmentSchema = z
  .object({
    model: literResolvedModelIdentitySchema,
    servedAlias: literServedAliasIdentitySchema
  })
  .strict()
export type LiterRoleAssignment = z.infer<typeof literRoleAssignmentSchema>

export const literRoleAssignmentsSchema = z
  .object({
    critic: literRoleAssignmentSchema,
    judge: literRoleAssignmentSchema,
    backup: literRoleAssignmentSchema
  })
  .strict()
export type LiterRoleAssignments = z.infer<typeof literRoleAssignmentsSchema>

export const literRoleSourceSchema = z.discriminatedUnion('ownership', [
  z.object({ ownership: z.literal('managed') }).strict(),
  z.object({ ownership: z.literal('local'), path: z.string().min(1) }).strict()
])
export type LiterRoleSource = z.infer<typeof literRoleSourceSchema>
export type LiterRoleSourceSelection = LiterRoleSource | { cancelled: true }

export const literRoleMutationSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    assignments: literRoleAssignmentsSchema
  })
  .strict()
export type LiterRoleMutation = z.infer<typeof literRoleMutationSchema>

export type LiterRoleSnapshot = {
  revision: number
  assignments?: LiterRoleAssignments
}

export type LiterRoleDocumentSnapshot = {
  source: LiterRoleSource
  path: string
  exists: boolean
  revision: string
  assignments?: LiterRoleAssignments
}

export type LiterRoleApplyResult = {
  source: LiterRoleSource
  state: 'applied' | 'conflict'
  baseRevision: string
  nextRevision: string
  conflict?: { expectedRevision: string; currentRevision: string }
  backupPath?: string
  appliedPath?: string
}

export type LiterRoleExportResult = {
  cancelled: boolean
  state?: 'deployment-required' | 'conflict'
  path?: string
  revision?: string
  conflict?: { expectedRevision: string; currentRevision: string }
}

export type LiterReviewerSelection =
  | {
      status: 'independent' | 'degraded'
      selectedRole: 'judge' | 'backup'
      assignment: LiterRoleAssignment
      reason: 'judge-distinct' | 'producer-identity-unknown' | 'judge-unavailable-or-collision-used-backup'
    }
  | {
      status: 'pending'
      reason: 'judge-unavailable-no-distinct-backup' | 'no-distinct-backup'
    }

function aliasKey(identity: LiterServedAliasIdentity): string {
  return JSON.stringify([identity.gatewayConnectionId, identity.alias])
}

export function selectIndependentLiterReviewer(input: {
  assignments: LiterRoleAssignments
  producer?: LiterResolvedModelIdentity
  availableAliases?: LiterServedAliasIdentity[]
}): LiterReviewerSelection {
  const criticKey = literResolvedModelIdentityKey(input.assignments.critic.model)
  const producerKey = input.producer ? literResolvedModelIdentityKey(input.producer) : undefined
  const available = input.availableAliases
    ? new Set(input.availableAliases.map((identity) => aliasKey(identity)))
    : undefined
  const isAvailable = (assignment: LiterRoleAssignment) => !available || available.has(aliasKey(assignment.servedAlias))
  const collides = (assignment: LiterRoleAssignment) => {
    const key = literResolvedModelIdentityKey(assignment.model)
    return key === criticKey || key === producerKey
  }

  if (isAvailable(input.assignments.judge) && !collides(input.assignments.judge)) {
    return {
      status: producerKey ? 'independent' : 'degraded',
      selectedRole: 'judge',
      assignment: input.assignments.judge,
      reason: producerKey ? 'judge-distinct' : 'producer-identity-unknown'
    }
  }
  if (isAvailable(input.assignments.backup) && !collides(input.assignments.backup)) {
    return {
      status: producerKey ? 'independent' : 'degraded',
      selectedRole: 'backup',
      assignment: input.assignments.backup,
      reason: producerKey ? 'judge-unavailable-or-collision-used-backup' : 'producer-identity-unknown'
    }
  }
  return {
    status: 'pending',
    reason: isAvailable(input.assignments.judge) ? 'no-distinct-backup' : 'judge-unavailable-no-distinct-backup'
  }
}
