// Stand-in for `@data/migration/v2`: Web databases start on the v2 schema and never run the
// one-shot v1 → v2 import, which needs the desktop's v1 files.
export const readMigrationV2CompletedAt = (): number | undefined => undefined
