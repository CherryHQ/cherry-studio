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
  readFileSafe
} from './skills-common'

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

function checkClaudeSkillFile(skillName: string, errors: string[]) {
  const skillDir = path.join(CLAUDE_SKILLS_DIR, skillName)
  const skillFile = path.join(skillDir, 'SKILL.md')

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
    const target = fs.readlinkSync(skillFile)
    const expectedTarget = `../../../.agents/skills/${skillName}/SKILL.md`
    if (target !== expectedTarget) {
      errors.push(`.claude/skills/${skillName}/SKILL.md points to '${target}', expected '${expectedTarget}'`)
    }
    return
  }

  if (!stat.isFile()) {
    errors.push(`.claude/skills/${skillName}/SKILL.md is neither a file nor a symlink`)
  }
}

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
