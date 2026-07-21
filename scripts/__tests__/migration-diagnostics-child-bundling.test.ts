import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')
const execFileAsync = promisify(execFile)

describe('migration database diagnostics child bundling contract', () => {
  it('builds and scans an isolated main artifact without reading the repository out directory', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-diagnostics-main-build-'))
    const outDir = path.join(tempRoot, 'out')
    const electronViteCli = path.join(root, 'node_modules/electron-vite/bin/electron-vite.js')
    const buildConfig = path.join(root, 'scripts/fixtures/migration-diagnostics-main-build.config.ts')

    expect(fs.existsSync(outDir)).toBe(false)
    try {
      await execFileAsync(
        process.execPath,
        [
          electronViteCli,
          'build',
          root,
          '--config',
          buildConfig,
          '--outDir',
          outDir,
          '--logLevel',
          'error',
          '--clearScreen',
          'false'
        ],
        {
          cwd: root,
          env: { ...process.env, VISUALIZER_MAIN: '' },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60_000
        }
      )

      const mainDir = path.join(outDir, 'main')
      const entries = await fs.promises.readdir(mainDir)
      expect(entries).toContain('main.js')

      const mainArtifact = await fs.promises.readFile(path.join(mainDir, 'main.js'), 'utf8')
      const referencedChildEntries = [
        ...new Set(
          Array.from(
            mainArtifact.matchAll(/["']\.\/(migrationDatabaseDiagnosticsChild-[A-Za-z0-9_-]+\.js)["']/g),
            (match) => match[1]
          )
        )
      ]
      expect(referencedChildEntries).toHaveLength(1)
      const childEntry = referencedChildEntries[0]
      if (childEntry === undefined) {
        throw new Error('The emitted main artifact does not reference a diagnostics child entry')
      }

      const emittedChildEntries = entries
        .filter((entry) => /^migrationDatabaseDiagnosticsChild-[A-Za-z0-9_-]+\.js$/.test(entry))
        .sort()
      expect(emittedChildEntries).toEqual([childEntry])
      expect(fs.existsSync(path.join(outDir, 'preload'))).toBe(false)
      expect(fs.existsSync(path.join(outDir, 'renderer'))).toBe(false)

      const childArtifact = await fs.promises.readFile(path.join(mainDir, childEntry), 'utf8')

      expect(mainArtifact).not.toContain('Migration database diagnostics child requires IPC')
      expect(childArtifact).toMatch(/require\(["']better-sqlite3["']\)/)
      expect(childArtifact).not.toMatch(
        /@logger|LoggerService|loggerService|from ["']zod["']|require\(["']zod["']\)|MigrationDbService|MigrationEngine|child_process|console\.|serviceRegistry|BaseService|@application/
      )
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    }
  }, 60_000)
})
