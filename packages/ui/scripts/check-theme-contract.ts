import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildThemeContractCss, loadThemeContractInputs } from './build-theme-css'
import { validateMigrationContract } from './validate-migration-contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, '../../..')
const DEFAULT_STYLES_DIR = path.resolve(__dirname, '../src/styles')

export function assertGeneratedThemeCssCurrent(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error('[theme-contract] generated theme.css is stale; run pnpm --filter @cherrystudio/ui theme:build')
  }
}

export async function checkThemeContract(
  stylesDir = DEFAULT_STYLES_DIR,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT
): Promise<void> {
  const expectedThemeCss = buildThemeContractCss(await loadThemeContractInputs(stylesDir))
  const actualThemeCss = await fs.readFile(path.join(stylesDir, 'theme.css'), 'utf8')

  assertGeneratedThemeCssCurrent(actualThemeCss, expectedThemeCss)
  await validateMigrationContract(repositoryRoot)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void checkThemeContract().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
