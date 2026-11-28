import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

import matter from 'gray-matter'

import {
  AGENTS_SKILLS_DIR,
  AGENTS_SKILLS_GITIGNORE,
  buildAgentsSkillsGitignore,
  buildClaudeSkillsGitignore,
  CLAUDE_SKILLS_DIR,
  CLAUDE_SKILLS_GITIGNORE,
  listSkillNames,
  readFileSafe,
  ROOT_DIR,
  SKILL_NAME_PATTERN
} from './skills-common'

function isAgentsReadmeFile(file: string): boolean {
  return /^\.agents\/skills\/README(?:\.[a-z0-9-]+)?\.md$/i.test(file)
}

function isClaudeReadmeFile(file: string): boolean {
  return /^\.claude\/skills\/README(?:\.[a-z0-9-]+)?\.md$/i.test(file)
}

function checkGitignore(filePath: string, expected: string, displayPath: string, errors: string[]) {
  const actual = readFileSafe(filePath)
  if (actual === null) {
    errors.push(`${displayPath} is missing`)
    return
  }
  if (actual !== expected) {
    errors.push(`${displayPath} is out of date (run pnpm skills:sync)`)
  }
}

/**
 * Verifies `.claude/skills/<skillName>` is a symlink pointing to
 * `../../.agents/skills/<skillName>`.
 */
function checkClaudeSkillSymlink(skillName: string, errors: string[]) {
  const claudeSkillDir = path.join(CLAUDE_SKILLS_DIR, skillName)
  const expectedTarget = path.join('..', '..', '.agents', 'skills', skillName)

  let stat: fs.Stats
  try {
    stat = fs.lstatSync(claudeSkillDir)
  } catch {
    errors.push(`.claude/skills/${skillName} is missing (run pnpm skills:sync)`)
    return
  }

  if (!stat.isSymbolicLink()) {
    errors.push(
      `.claude/skills/${skillName} must be a symlink, not a ${stat.isDirectory() ? 'directory' : 'file'} (run pnpm skills:sync)`
    )
    return
  }

  const actualTarget = fs.readlinkSync(claudeSkillDir)
  if (actualTarget !== expectedTarget) {
    errors.push(`.claude/skills/${skillName} symlink points to '${actualTarget}', expected '${expectedTarget}'`)
  }
}

/** The file every skill directory owes, per `.agents/skills/README.md` and the `create-skill` skill's template. */
const SKILL_FILE = 'SKILL.md'

/** The fields a SKILL.md's frontmatter owes: what the skill is called, and when to reach for it. */
const SKILL_FRONTMATTER_FIELDS = ['name', 'description'] as const

/**
 * Validates the SKILL.md contract of one public skill: the file exists, opens with a frontmatter block
 * that carries a `name` and a `description`, names itself by the naming rules, and has a body.
 *
 * A skill whose SKILL.md is missing or unnamed still passes the whitelist and symlink checks, because
 * those only look at the directory — it fails later, when `SkillInstaller` hashes the SKILL.md it
 * cannot find.
 */
export function checkSkillFile(skillDir: string, skillName: string): string[] {
  const errors: string[] = []
  const displayPath = `.agents/skills/${skillName}/${SKILL_FILE}`

  let raw: string
  try {
    raw = fs.readFileSync(path.join(skillDir, SKILL_FILE), 'utf-8')
  } catch {
    errors.push(`${displayPath} is missing (every skill needs a SKILL.md)`)
    return errors
  }

  if (!/^---[ \t]*\r?\n/.test(raw)) {
    errors.push(`${displayPath} is missing its YAML frontmatter block`)
    return errors
  }

  const { data, content } = matter(raw)
  for (const field of SKILL_FRONTMATTER_FIELDS) {
    const value = data[field]
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${displayPath} is missing the frontmatter \`${field}\` field`)
    }
  }

  const declaredName = data.name
  if (typeof declaredName === 'string' && declaredName.trim() !== '' && !SKILL_NAME_PATTERN.test(declaredName)) {
    errors.push(
      `${displayPath}: frontmatter \`name\` '${declaredName}' breaks the naming rules (lowercase letters, digits and hyphens)`
    )
  }

  if (content.trim() === '') {
    errors.push(`${displayPath} has no body — it owes its workflow instructions`)
  }

  return errors
}

function checkTrackedFilesAgainstWhitelist(skillNames: string[], errors: string[]) {
  const sharedAgentsFiles = new Set(['.agents/skills/.gitignore', '.agents/skills/public-skills.txt'])
  const sharedClaudeFiles = new Set(['.claude/skills/.gitignore'])
  const allowedAgentsPrefixes = skillNames.map((skillName) => `.agents/skills/${skillName}/`)
  const allowedClaudeSymlinks = new Set(skillNames.map((skillName) => `.claude/skills/${skillName}`))
  const allowedClaudePrefixes = skillNames.map((skillName) => `.claude/skills/${skillName}/`)

  let trackedFiles: string[]
  try {
    const output = execSync('git ls-files -- .agents/skills .claude/skills', {
      cwd: ROOT_DIR,
      encoding: 'utf-8'
    })
    trackedFiles = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.push(`failed to read tracked skill files via git ls-files: ${message}`)
    return
  }

  for (const file of trackedFiles) {
    if (file.startsWith('.agents/skills/')) {
      if (sharedAgentsFiles.has(file) || isAgentsReadmeFile(file)) {
        continue
      }
      if (allowedAgentsPrefixes.some((prefix) => file.startsWith(prefix))) {
        continue
      }
      errors.push(`tracked file is outside public skill whitelist: ${file}`)
      continue
    }

    if (file.startsWith('.claude/skills/')) {
      if (sharedClaudeFiles.has(file) || isClaudeReadmeFile(file)) {
        continue
      }
      if (allowedClaudeSymlinks.has(file) || allowedClaudePrefixes.some((prefix) => file.startsWith(prefix))) {
        continue
      }
      errors.push(`tracked file is outside public skill whitelist: ${file}`)
    }
  }
}

/**
 * Validates public skills governance:
 * - generated gitignore files are up to date
 * - Claude skill files match source skills by content
 * - tracked skill files do not exceed the public whitelist
 * - every public skill's SKILL.md carries the frontmatter the README requires
 */
function main() {
  let skillNames: string[]
  try {
    skillNames = listSkillNames()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`skills:check failed: ${message}`)
    process.exit(1)
  }

  const errors: string[] = []

  checkGitignore(AGENTS_SKILLS_GITIGNORE, buildAgentsSkillsGitignore(skillNames), '.agents/skills/.gitignore', errors)
  checkGitignore(CLAUDE_SKILLS_GITIGNORE, buildClaudeSkillsGitignore(skillNames), '.claude/skills/.gitignore', errors)

  for (const skillName of skillNames) {
    const agentSkillDir = path.join(AGENTS_SKILLS_DIR, skillName)
    if (!fs.existsSync(agentSkillDir)) {
      errors.push(`.agents/skills/${skillName} is missing`)
      continue
    }

    errors.push(...checkSkillFile(agentSkillDir, skillName))
    checkClaudeSkillSymlink(skillName, errors)
  }
  checkTrackedFilesAgainstWhitelist(skillNames, errors)

  if (errors.length > 0) {
    console.error('skills:check failed')
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }

  console.log(`skills:check passed (${skillNames.length} public skill${skillNames.length === 1 ? '' : 's'})`)
}

if (require.main === module) main()
