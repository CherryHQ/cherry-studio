import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

import {
  AGENTS_SKILLS_DIR,
  AGENTS_SKILLS_GITIGNORE,
  buildAgentsSkillsGitignore,
  buildClaudeSkillsGitignore,
  CLAUDE_SKILLS_DIR,
  CLAUDE_SKILLS_GITIGNORE,
  listSkillNames,
  readFileSafe,
  ROOT_DIR
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
 * Verifies `.claude/skills/<skillName>/SKILL.md` is correctly synced with
 * `.agents/skills/<skillName>/SKILL.md`.
 * Requires regular files (symlinks are disallowed for cross-platform compatibility).
 */
function checkClaudeSkillFile(skillName: string, errors: string[]) {
  const skillDir = path.join(CLAUDE_SKILLS_DIR, skillName)
  const skillFile = path.join(skillDir, 'SKILL.md')
  const agentsSkillFile = path.join(AGENTS_SKILLS_DIR, skillName, 'SKILL.md')

  if (!fs.existsSync(skillDir)) {
    errors.push(`.claude/skills/${skillName} is missing`)
    return
  }

  if (!fs.statSync(skillDir).isDirectory()) {
    errors.push(`.claude/skills/${skillName} is not a directory`)
    return
  }

  let stat: fs.Stats
  try {
    stat = fs.lstatSync(skillFile)
  } catch {
    errors.push(`.claude/skills/${skillName}/SKILL.md is missing`)
    return
  }

  if (stat.isSymbolicLink()) {
    errors.push(`.claude/skills/${skillName}/SKILL.md must be a regular file, not a symlink`)
    return
  }

  if (!stat.isFile()) {
    errors.push(`.claude/skills/${skillName}/SKILL.md is not a regular file`)
    return
  }

  const expectedContent = readFileSafe(agentsSkillFile)
  const actualContent = readFileSafe(skillFile)
  if (expectedContent === null || actualContent === null) {
    errors.push(`failed to read .claude/skills/${skillName}/SKILL.md for content verification`)
    return
  }

  if (actualContent !== expectedContent) {
    errors.push(`.claude/skills/${skillName}/SKILL.md content differs from .agents/skills/${skillName}/SKILL.md`)
  }
}

function checkTrackedFilesAgainstWhitelist(skillNames: string[], errors: string[]) {
  const sharedAgentsFiles = new Set(['.agents/skills/.gitignore', '.agents/skills/public-skills.txt'])
  const sharedClaudeFiles = new Set(['.claude/skills/.gitignore'])
  const allowedAgentsPrefixes = skillNames.map((skillName) => `.agents/skills/${skillName}/`)
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
      if (allowedClaudePrefixes.some((prefix) => file.startsWith(prefix))) {
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
    const agentSkillPath = path.join(AGENTS_SKILLS_DIR, skillName, 'SKILL.md')
    if (!fs.existsSync(agentSkillPath)) {
      errors.push(`.agents/skills/${skillName}/SKILL.md is missing`)
      continue
    }

    checkClaudeSkillFile(skillName, errors)
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

main()
