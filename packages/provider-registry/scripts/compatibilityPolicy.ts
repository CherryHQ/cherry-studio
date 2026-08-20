import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGISTRY_SCHEMA_VERSION } from '../src/registry-loader'

interface CompatibilityPolicyInput {
  baseVersion: number | null
  currentVersion: number
  baseBaselines: ReadonlyMap<number, string>
  currentBaselines: ReadonlyMap<number, string>
}

const BASELINE_PATTERN = /^v(\d+)-validator\.mjs$/
const VERSION_PATTERN = /REGISTRY_SCHEMA_VERSION\s*=\s*(\d+)/
const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = path.dirname(scriptPath)

export function getCompatibilityPolicyViolations(input: CompatibilityPolicyInput): string[] {
  const violations: string[] = []
  const { baseVersion, currentVersion, baseBaselines, currentBaselines } = input

  if (baseVersion === null) {
    if (currentVersion !== 1) {
      violations.push(`The first REGISTRY_SCHEMA_VERSION must be 1, received ${currentVersion}`)
    }
  } else if (currentVersion !== baseVersion && currentVersion !== baseVersion + 1) {
    violations.push(
      `REGISTRY_SCHEMA_VERSION must stay at ${baseVersion} or increase to ${baseVersion + 1}, received ${currentVersion}`
    )
  }

  for (const [version, content] of baseBaselines) {
    if (currentBaselines.get(version) !== content) {
      violations.push(`compat/v${version}-validator.mjs is frozen and must not be modified`)
    }
  }

  if (!currentBaselines.has(currentVersion)) {
    violations.push(`compat/v${currentVersion}-validator.mjs is required for REGISTRY_SCHEMA_VERSION ${currentVersion}`)
  }

  const allowedVersions = new Set(baseBaselines.keys())
  allowedVersions.add(currentVersion)
  for (const version of currentBaselines.keys()) {
    if (!allowedVersions.has(version)) {
      violations.push(`compat/v${version}-validator.mjs does not correspond to an accepted schema version`)
    }
  }

  return violations
}

function parseVersion(source: string): number | null {
  const match = source.match(VERSION_PATTERN)
  return match ? Number(match[1]) : null
}

function readCurrentBaselines(compatDirectory: string): Map<number, string> {
  const baselines = new Map<number, string>()
  if (!existsSync(compatDirectory)) return baselines

  for (const name of readdirSync(compatDirectory)) {
    const match = name.match(BASELINE_PATTERN)
    if (match) baselines.set(Number(match[1]), readFileSync(path.join(compatDirectory, name), 'utf8'))
  }
  return baselines
}

function readBaseBaselines(repositoryRoot: string, baseRef: string, compatPath: string): Map<number, string> {
  const baselines = new Map<number, string>()
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseRef, '--', compatPath], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })

  for (const file of files.split('\n').filter(Boolean)) {
    const match = path.basename(file).match(BASELINE_PATTERN)
    if (!match) continue
    const content = execFileSync('git', ['show', `${baseRef}:${file}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    })
    baselines.set(Number(match[1]), content)
  }
  return baselines
}

export function checkCompatibilityPolicy(baseRef: string): void {
  const repositoryRoot = path.resolve(scriptDirectory, '../../..')
  const packageRoot = path.resolve(scriptDirectory, '..')
  const registryLoaderPath = 'packages/provider-registry/src/registry-loader.ts'
  let baseVersion: number | null = null

  try {
    const baseSource = execFileSync('git', ['show', `${baseRef}:${registryLoaderPath}`], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    })
    baseVersion = parseVersion(baseSource)
  } catch {
    // This is the initial introduction of the versioned remote registry contract.
  }

  const violations = getCompatibilityPolicyViolations({
    baseVersion,
    currentVersion: REGISTRY_SCHEMA_VERSION,
    baseBaselines: readBaseBaselines(repositoryRoot, baseRef, 'packages/provider-registry/compat'),
    currentBaselines: readCurrentBaselines(path.join(packageRoot, 'compat'))
  })

  if (violations.length > 0) {
    throw new Error(violations.join('\n'))
  }
}

const isCommandLine = process.argv[1] && path.resolve(process.argv[1]) === scriptPath
if (isCommandLine) {
  const baseRef = process.argv.slice(2).find((argument) => argument !== '--')
  if (!baseRef) {
    console.error('Usage: pnpm compat:policy <git-base-ref>')
    process.exitCode = 1
  } else {
    try {
      checkCompatibilityPolicy(baseRef)
      console.log('Provider-registry compatibility baseline policy passed')
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
