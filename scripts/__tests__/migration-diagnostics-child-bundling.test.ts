import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import electronViteConfig, { isMainExternalModule } from '../../electron.vite.config'

const root = path.resolve(__dirname, '..', '..')
const hostFile = path.join(root, 'src/main/data/migration/v2/diagnostics/MigrationDatabaseDiagnostics.ts')
const childFile = path.join(root, 'src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsChild.ts')

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
})
