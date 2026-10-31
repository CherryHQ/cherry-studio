import { resolve } from 'path'

import { defineConfig } from 'vitest/config'

import rootConfig from '../../vitest.config'

// Re-runs the main-process suite with better-sqlite3 replaced by the wasm facade,
// proving the data layer needs no changes to run on sqlite-wasm.
const repoRoot = resolve(__dirname, '../..')

// Suites that need what the Web edition deliberately lacks; everything else must pass.
const OUT_OF_SCOPE = [
  // Real database files on disk: backup/restore, WAL checkpoints, VACUUM INTO, file copies.
  'src/main/data/db/restore/__tests__/**',
  'src/main/data/migration/v2/core/__tests__/MigrationDbService.test.ts',
  'src/main/services/cacheCleanup/__tests__/CacheCleanupService.test.ts',
  // better-sqlite3's online backup API.
  'src/main/ai/runtime/pi/__tests__/retiredSessionHistory.test.ts',
  'src/main/features/browser/__tests__/browserImport.test.ts',
  // Legacy v1 migration: ATTACHes or probes v1 database files on disk.
  'src/main/data/migration/v2/migrators/__tests__/AgentsMigrator*.test.ts',
  'src/main/data/migration/v2/migrators/__tests__/KnowledgeVectorMigrator.test.ts',
  'src/main/data/migration/v2/utils/__tests__/KnowledgeVectorSourceReader.test.ts',
  'src/main/data/migration/v2/utils/__tests__/LegacyAgentsDbReader.test.ts',
  // Vector store: loads the sqlite-vec native extension.
  'src/main/features/knowledge/pipeline/vectorstore/**/__tests__/**',
  // Live network probes; fails offline regardless of the driver.
  'src/main/services/network/__tests__/probes.e2e.test.ts'
]
const mainProject = rootConfig.test!.projects!.find(
  (project) => typeof project === 'object' && 'test' in project && project.test?.name === 'main'
) as { resolve: { alias: { find: string | RegExp; replacement: string }[] }; test: Record<string, unknown> }

export default defineConfig({
  ...mainProject,
  root: repoRoot,
  resolve: {
    alias: [
      { find: /^better-sqlite3$/, replacement: resolve(__dirname, 'testing/betterSqlite3.ts') },
      ...mainProject.resolve.alias
    ]
  },
  test: {
    ...mainProject.test,
    name: 'main (sqlite-wasm)',
    globals: true,
    exclude: [...(rootConfig.test!.exclude ?? []), ...OUT_OF_SCOPE]
  }
})
