export interface MigrationIdentity {
  readonly folderMillis: number
  readonly hash: string
}

export type MigrationChainRelation = 'in-sync' | 'behind' | 'ahead' | 'forked'

export function compareMigrationChains(
  applied: readonly MigrationIdentity[],
  bundled: readonly MigrationIdentity[]
): MigrationChainRelation {
  for (let i = 0; i < Math.min(applied.length, bundled.length); i++) {
    if (applied[i].folderMillis !== bundled[i].folderMillis || applied[i].hash !== bundled[i].hash) return 'forked'
  }
  if (applied.length === bundled.length) return 'in-sync'
  return applied.length < bundled.length ? 'behind' : 'ahead'
}
