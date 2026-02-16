import * as fs from 'fs'
import * as path from 'path'

import { AGENTS_SKILLS_DIR, CLAUDE_SKILLS_DIR } from './skills-common'
import {
  AGENTS_SKILLS_GITIGNORE,
  buildAgentsSkillsGitignore,
  buildClaudeSkillsGitignore,
  CLAUDE_SKILLS_GITIGNORE,
  listSkillNames,
  writeFileIfChanged
} from './skills-common'

/**
 * Ensures `.claude/skills/<skillName>/SKILL.md` is synchronized with
 * `.agents/skills/<skillName>/SKILL.md`.
 * Uses file copy to keep cross-platform compatibility.
 */
function ensureClaudeSkillFile(skillName: string): boolean {
  const agentsSkillFile = path.join(AGENTS_SKILLS_DIR, skillName, 'SKILL.md')
  const claudeSkillDir = path.join(CLAUDE_SKILLS_DIR, skillName)
  const claudeSkillFile = path.join(claudeSkillDir, 'SKILL.md')

  if (!fs.existsSync(agentsSkillFile)) {
    throw new Error(`.agents/skills/${skillName}/SKILL.md is missing`)
  }

  fs.mkdirSync(claudeSkillDir, { recursive: true })

  const expectedContent = fs.readFileSync(agentsSkillFile, 'utf-8')

  let existing: fs.Stats | null = null
  try {
    existing = fs.lstatSync(claudeSkillFile)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') {
      throw error
    }
  }

  if (existing !== null && !existing.isFile()) {
    fs.rmSync(claudeSkillFile, { force: true, recursive: true })
    existing = null
  } else if (existing?.isFile()) {
    const currentContent = fs.readFileSync(claudeSkillFile, 'utf-8')
    if (currentContent === expectedContent) {
      return false
    }
  }

  fs.writeFileSync(claudeSkillFile, expectedContent, 'utf-8')
  return true
}

/**
 * Synchronizes skill infrastructure for all public skills:
 * - regenerates whitelist gitignore files
 * - syncs Claude-side SKILL.md files
 */
function main() {
  let skillNames: string[]
  try {
    skillNames = listSkillNames()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`skills:sync failed: ${message}`)
    process.exit(1)
  }

  const agentsGitignore = buildAgentsSkillsGitignore(skillNames)
  const claudeGitignore = buildClaudeSkillsGitignore(skillNames)

  const changedFiles: string[] = []
  const changedSkillFiles: string[] = []

  if (writeFileIfChanged(AGENTS_SKILLS_GITIGNORE, agentsGitignore)) {
    changedFiles.push('.agents/skills/.gitignore')
  }
  if (writeFileIfChanged(CLAUDE_SKILLS_GITIGNORE, claudeGitignore)) {
    changedFiles.push('.claude/skills/.gitignore')
  }
  for (const skillName of skillNames) {
    if (ensureClaudeSkillFile(skillName)) {
      changedSkillFiles.push(`.claude/skills/${skillName}/SKILL.md`)
    }
  }

  if (changedFiles.length === 0 && changedSkillFiles.length === 0) {
    console.log(`skills:sync up-to-date (${skillNames.length} public skill${skillNames.length === 1 ? '' : 's'})`)
    return
  }

  const updatedCount = changedFiles.length + changedSkillFiles.length
  console.log(`skills:sync updated ${updatedCount} file${updatedCount === 1 ? '' : 's'}:`)
  for (const file of changedFiles) {
    console.log(`- ${file}`)
  }
  for (const file of changedSkillFiles) {
    console.log(`- ${file}`)
  }
}

main()
