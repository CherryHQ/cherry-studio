/** Enforces the docs tree shape: a closed set of domain directories under docs/references, each owning a README.md home. */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')

/** The closed set of reference domains. Adding a domain is deliberate: extend this list in the same PR that creates the directory. */
export const REFERENCE_DOMAINS: readonly string[] = [
  'ai',
  'api-gateway',
  'architecture',
  'binary-manager',
  'chat',
  'command',
  'components',
  'data',
  'diagnostics',
  'file',
  'i18n',
  'ipc',
  'job-and-scheduler',
  'knowledge',
  'lan-transfer',
  'lifecycle',
  'logging',
  'provider-model',
  'security',
  'testing',
  'window-manager'
]

export const checkStructure = (referencesDir: string, domains: readonly string[] = REFERENCE_DOMAINS): string[] => {
  const failures: string[] = []
  const entries = fs.readdirSync(referencesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!domains.includes(entry.name)) {
        failures.push(
          `${entry.name}/: not in the closed domain set — add it to REFERENCE_DOMAINS in scripts/verify-doc-structure.ts deliberately, or relocate the directory`
        )
      }
      if (!fs.existsSync(path.join(referencesDir, entry.name, 'README.md'))) {
        failures.push(`${entry.name}/: missing README.md — every domain directory has a README home`)
      }
    } else {
      failures.push(`${entry.name}: loose file at the references root — every doc lives inside a domain directory`)
    }
  }

  for (const domain of domains) {
    if (!entries.some((entry) => entry.isDirectory() && entry.name === domain)) {
      failures.push(`${domain}/: listed in the closed domain set but missing on disk`)
    }
  }

  return failures
}

const main = () => {
  const failures = checkStructure(path.join(ROOT, 'docs/references'))
  if (failures.length > 0) {
    console.error(`Found ${failures.length} docs structure violation(s):\n`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  console.log('Docs structure OK.')
}

if (require.main === module) main()
