import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'tsdown'

import { REGISTRY_SCHEMA_VERSION } from '../src/registry-loader'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../..')
const targetName = `v${REGISTRY_SCHEMA_VERSION}-validator.mjs`
const targetPath = path.join(packageRoot, 'compat', targetName)
const temporaryPath = path.join(packageRoot, 'compat', `.${targetName.replace(/\.mjs$/, '.tmp.mjs')}`)

async function createCompatibilityBaseline(): Promise<void> {
  if (existsSync(targetPath)) {
    throw new Error(`${path.relative(packageRoot, targetPath)} already exists and is immutable`)
  }

  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'provider-registry-baseline-'))
  try {
    await build({
      config: false,
      entry: {
        [`v${REGISTRY_SCHEMA_VERSION}-validator`]: path.join(packageRoot, 'scripts/compatibilityValidatorEntry.ts')
      },
      outDir: outputDirectory,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      clean: true,
      minify: true,
      sourcemap: false,
      dts: false,
      report: false,
      tsconfig: false,
      noExternal: [/^zod(?:\/|$)/]
    })

    const bundle = readFileSync(path.join(outputDirectory, targetName), 'utf8').replace(/[ \t]+$/gm, '')
    writeFileSync(
      temporaryPath,
      `/* eslint-disable */\n// AUTO-GENERATED compatibility contract. Never edit or replace this file.\n${bundle}`
    )
    execFileSync('pnpm', ['oxfmt', '--write', temporaryPath], {
      cwd: repositoryRoot,
      stdio: 'inherit'
    })
    renameSync(temporaryPath, targetPath)
    console.log(`Created frozen registry compatibility baseline ${path.relative(packageRoot, targetPath)}`)
  } finally {
    rmSync(temporaryPath, { force: true })
    rmSync(outputDirectory, { recursive: true, force: true })
  }
}

void createCompatibilityBaseline()
