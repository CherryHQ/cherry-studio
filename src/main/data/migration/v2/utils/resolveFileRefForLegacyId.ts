import type { MigrationContext } from '../core/MigrationContext'

export type ResolveResult = { kind: 'resolved'; v2Id: string } | { kind: 'missing'; legacyId: string }

export function resolveFileRefForLegacyId(ctx: MigrationContext, legacyId: string): ResolveResult {
  const remap = ctx.sharedData.get('file.idRemap') as Map<string, string> | undefined
  if (!remap) return { kind: 'missing', legacyId }
  const v2Id = remap.get(legacyId)
  if (v2Id) return { kind: 'resolved', v2Id }
  ctx.logger.warn(`file-migrator idRemap miss: ${legacyId} — file may have been orphaned in v1`)
  return { kind: 'missing', legacyId }
}
