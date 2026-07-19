import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import electronViteConfig, { isMainExternalModule } from '../../electron.vite.config'

const root = path.resolve(__dirname, '..', '..')
const hostFile = path.join(root, 'src/main/data/migration/v2/diagnostics/MigrationDatabaseDiagnostics.ts')
const childFile = path.join(root, 'src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsChild.ts')
const execFileAsync = promisify(execFile)

describe('migration database diagnostics child bundling contract', () => {
  it('keeps main as one named input while allowing a fixed modulePath child asset', () => {
    const mainBuild = (electronViteConfig as any).main.build

    expect(mainBuild.lib).toBeUndefined()
    expect(mainBuild.rollupOptions.input).toBe(path.join(root, 'src/main/main.ts'))
    expect(mainBuild.rollupOptions.output).toMatchObject({
      entryFileNames: 'main.js',
      format: 'cjs',
      inlineDynamicImports: true
    })
    expect(mainBuild.rollupOptions.output.manualChunks).toBeUndefined()

    const hostSource = fs.readFileSync(hostFile, 'utf8')
    expect(hostSource).toContain("'./migrationDatabaseDiagnosticsChild?modulePath'")
    expect(hostSource).not.toContain('?nodeWorker')
  })

  it('keeps the isolated child fixed, logger-free, and externally linked to better-sqlite3', () => {
    expect(fs.existsSync(childFile)).toBe(true)
    if (!fs.existsSync(childFile)) return

    const childSource = fs.readFileSync(childFile, 'utf8')
    expect(isMainExternalModule('better-sqlite3')).toBe(true)
    expect(childSource).toContain("from 'better-sqlite3'")
    expect(childSource).not.toMatch(/@logger|LoggerService|\b(?:console|spawn|fork|exec|execFile)\s*[.(]/)
    expect(childSource).not.toContain("from 'zod'")
    expect(childSource).not.toMatch(/@main\/|@application|@data\/db\/services/)
  })

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
