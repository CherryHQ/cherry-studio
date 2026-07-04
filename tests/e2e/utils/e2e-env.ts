import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Local, repo-external test configuration for agent-domain e2e (knowledge / websearch /
 * fileprocessing). Real values live ONLY in `~/.cherry-e2e/secrets.local.json` — never
 * commit keys, internal endpoints, or absolute paths. The committed specs reference logical
 * fixture keys (e.g. `dupe-a`) that resolve to machine-local absolute paths at runtime.
 */
export interface E2ESecrets {
  fixtures?: Record<string, string | string[]>
  providers?: Record<string, Record<string, string | null>>
  activeProviders?: Record<string, string[]>
}

const SECRETS_PATH = process.env.CHERRY_E2E_SECRETS ?? path.join(os.homedir(), '.cherry-e2e', 'secrets.local.json')
const GOLDEN_DIR = process.env.CHERRY_E2E_GOLDEN ?? path.join(os.homedir(), '.cherry-e2e', 'golden-profileDev')

let cached: E2ESecrets | null | undefined

function loadSecrets(): E2ESecrets | null {
  if (cached !== undefined) return cached
  try {
    cached = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')) as E2ESecrets
  } catch {
    cached = null
  }
  return cached
}

/** Resolve a logical fixture key to its machine-local absolute path (first entry if an array). */
export function fixturePath(key: string): string {
  const value = loadSecrets()?.fixtures?.[key]
  const resolved = Array.isArray(value) ? value[0] : value
  if (!resolved) {
    throw new Error(`E2E fixture "${key}" is not defined in ${SECRETS_PATH}`)
  }
  return resolved
}

/**
 * Resolve a provider secret (e.g. `embeddingModelId`) for a domain, matching the previous
 * runner's `${secrets.X}`: the first provider listed in `activeProviders[domain]` that defines
 * a non-empty value for the field. Returns null if none do (caller may skip-if-absent).
 */
export function providerSecret(domain: string, field: string): string | null {
  const secrets = loadSecrets()
  for (const name of secrets?.activeProviders?.[domain] ?? []) {
    const value = secrets?.providers?.[name]?.[field]
    if (value != null && value !== '') return value
  }
  return null
}

/** Path to the golden userData profile (seeded "old user + key, zh-CN" state). */
export function goldenProfileDir(): string {
  if (!fs.existsSync(GOLDEN_DIR)) {
    throw new Error(`Golden profile not found at ${GOLDEN_DIR} (set CHERRY_E2E_GOLDEN to override)`)
  }
  return GOLDEN_DIR
}

/** Directory of seed markdown notes (used to point `feature.notes.path` at for note-source tests). */
export function notesSeedDir(): string {
  const dir = process.env.CHERRY_E2E_NOTES_SEED ?? path.join(os.homedir(), '.cherry-e2e', 'seed', 'notes')
  if (!fs.existsSync(dir)) {
    throw new Error(`Notes seed dir not found at ${dir} (set CHERRY_E2E_NOTES_SEED to override)`)
  }
  return dir
}
