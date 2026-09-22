/**
 * Copies the Prometheus mini pack's skills into `resources/skills/`, where
 * `installBuiltinSkills()` picks them up on every launch.
 *
 * `resources/skills/` is git-tracked, so the copies are committed and reviewable. That
 * means they can drift from the submodule, which is what `--check` exists to catch — the
 * same shape as `build:builtin-knowledge` / `build:builtin-knowledge:check`.
 *
 *   pnpm skills:sync:prometheus          copy
 *   pnpm skills:sync:prometheus:check    fail if a copy is missing or stale
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT_DIR = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT_DIR, 'resources', 'prometheus-skills-mini', 'skills')
const TARGET_DIR = path.join(ROOT_DIR, 'resources', 'skills')

/**
 * Repo tooling that lives beside the skills but is not one. `AGENTS.md` documents the
 * directory for agents working IN the mini; the test file belongs to the mini's own suite.
 * Shipping either would register a non-skill in the app's skill library.
 */
const NOT_SKILLS = new Set(['AGENTS.md', 'carried-payload.test.mjs'])

type FileEntry = { relative: string; absolute: string }

function listSkillNames(): string[] {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(
      `${SOURCE_DIR} does not exist. Run \`git submodule update --init resources/prometheus-skills-mini\`.`
    )
  }
  return fs
    .readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_SKILLS.has(entry.name))
    .map((entry) => entry.name)
    .sort()
}

/** Every file under `dir`, relative to it. Sorted so two runs compare deterministically. */
function filesUnder(dir: string, prefix = ''): FileEntry[] {
  const out: FileEntry[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(absolute, relative))
    else if (entry.isFile()) out.push({ relative, absolute })
  }
  return out.sort((a, b) => a.relative.localeCompare(b.relative))
}

/** Byte-for-byte: a same-length edit must still count as drift. */
function differs(source: string, target: string): boolean {
  if (!fs.existsSync(target)) return true
  return !fs.readFileSync(source).equals(fs.readFileSync(target))
}

function syncSkill(name: string, check: boolean): string[] {
  const problems: string[] = []
  const sourceSkill = path.join(SOURCE_DIR, name)
  const targetSkill = path.join(TARGET_DIR, name)

  for (const file of filesUnder(sourceSkill)) {
    const target = path.join(targetSkill, ...file.relative.split('/'))
    if (!differs(file.absolute, target)) continue

    if (check) {
      problems.push(`${path.relative(ROOT_DIR, target)} is missing or out of date`)
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(file.absolute, target)
  }

  // A file the pack no longer ships must not linger in the target: it would keep being
  // installed as part of the skill long after it was deleted upstream.
  if (fs.existsSync(targetSkill)) {
    const sourceNames = new Set(filesUnder(sourceSkill).map((file) => file.relative))
    for (const file of filesUnder(targetSkill)) {
      if (sourceNames.has(file.relative)) continue
      if (check) {
        problems.push(`${path.relative(ROOT_DIR, file.absolute)} is not in the pack any more`)
        continue
      }
      fs.rmSync(file.absolute)
    }
  }

  return problems
}

function main(): void {
  const check = process.argv.includes('--check')
  const names = listSkillNames()

  if (names.length === 0) {
    console.error('sync-prometheus-skills: the submodule holds no skills — refusing to report success')
    process.exit(1)
  }

  const problems = names.flatMap((name) => syncSkill(name, check))

  if (check) {
    if (problems.length > 0) {
      console.error('skills:sync:prometheus:check failed — run `pnpm skills:sync:prometheus`:')
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exit(1)
    }
    console.log(`skills:sync:prometheus:check ok — ${names.length} skills current`)
    return
  }

  console.log(`sync-prometheus-skills: ${names.length} skills synced into resources/skills/`)
}

main()
