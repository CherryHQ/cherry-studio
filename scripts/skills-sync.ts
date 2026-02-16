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

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath))
}

function normalizeLinkedTarget(skillDir: string, target: string): string {
  return normalizePath(path.resolve(skillDir, target))
}

function isLiteralSymlinkTarget(content: string, skillDir: string, expectedResolvedTarget: string): boolean {
  const literalTarget = content.trim()
  if (literalTarget === '' || literalTarget.includes('\n')) {
    return false
  }
  return normalizeLinkedTarget(skillDir, literalTarget) === expectedResolvedTarget
}

function isSymlinkCreationError(error: unknown): boolean {
  const nodeError = error as NodeJS.ErrnoException
  return (
    nodeError?.code === 'EPERM' ||
    nodeError?.code === 'EACCES' ||
    nodeError?.code === 'ENOTSUP' ||
    nodeError?.code === 'EINVAL'
  )
}

/**
 * Ensures `.claude/skills/<skillName>/SKILL.md` is synchronized with
 * `.agents/skills/<skillName>/SKILL.md`.
 * Requires symlink support; no file-copy fallback is allowed.
 */
function ensureClaudeSkillLink(skillName: string): boolean {
  const agentsSkillFile = path.join(AGENTS_SKILLS_DIR, skillName, 'SKILL.md')
  const claudeSkillDir = path.join(CLAUDE_SKILLS_DIR, skillName)
  const claudeSkillFile = path.join(claudeSkillDir, 'SKILL.md')
  const expectedTarget = `../../../.agents/skills/${skillName}/SKILL.md`
  const expectedResolvedTarget = normalizePath(agentsSkillFile)

  if (!fs.existsSync(agentsSkillFile)) {
    throw new Error(`.agents/skills/${skillName}/SKILL.md is missing`)
  }

  fs.mkdirSync(claudeSkillDir, { recursive: true })

  let existing: fs.Stats | null = null
  try {
    existing = fs.lstatSync(claudeSkillFile)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') {
      throw error
    }
  }

  if (existing?.isSymbolicLink()) {
    const currentTarget = fs.readlinkSync(claudeSkillFile)
    const currentResolvedTarget = normalizeLinkedTarget(claudeSkillDir, currentTarget)
    if (currentResolvedTarget === expectedResolvedTarget) {
      return false
    }
    fs.unlinkSync(claudeSkillFile)
    existing = null
  }

  if (existing?.isFile()) {
    const currentContent = fs.readFileSync(claudeSkillFile, 'utf-8')
    const expectedContent = fs.readFileSync(agentsSkillFile, 'utf-8')
    if (
      currentContent === expectedContent ||
      isLiteralSymlinkTarget(currentContent, claudeSkillDir, expectedResolvedTarget)
    ) {
      return false
    }
    fs.unlinkSync(claudeSkillFile)
    existing = null
  }

  if (existing !== null) {
    fs.rmSync(claudeSkillFile, { force: true, recursive: true })
  }

  try {
    fs.symlinkSync(expectedTarget, claudeSkillFile)
  } catch (error) {
    if (isSymlinkCreationError(error)) {
      throw new Error(
        `failed to create symlink for .claude/skills/${skillName}/SKILL.md; enable symlink support or use WSL`
      )
    }
    throw error
  }

  return true
}

/**
 * Synchronizes skill infrastructure for all public skills:
 * - regenerates whitelist gitignore files
 * - syncs Claude-side SKILL.md links/files
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
  const changedSkillLinks: string[] = []

  if (writeFileIfChanged(AGENTS_SKILLS_GITIGNORE, agentsGitignore)) {
    changedFiles.push('.agents/skills/.gitignore')
  }
  if (writeFileIfChanged(CLAUDE_SKILLS_GITIGNORE, claudeGitignore)) {
    changedFiles.push('.claude/skills/.gitignore')
  }
  for (const skillName of skillNames) {
    if (ensureClaudeSkillLink(skillName)) {
      changedSkillLinks.push(`.claude/skills/${skillName}/SKILL.md`)
    }
  }

  if (changedFiles.length === 0 && changedSkillLinks.length === 0) {
    console.log(`skills:sync up-to-date (${skillNames.length} public skill${skillNames.length === 1 ? '' : 's'})`)
    return
  }

  const updatedCount = changedFiles.length + changedSkillLinks.length
  console.log(`skills:sync updated ${updatedCount} file${updatedCount === 1 ? '' : 's'}:`)
  for (const file of changedFiles) {
    console.log(`- ${file}`)
  }
  for (const file of changedSkillLinks) {
    console.log(`- ${file}`)
  }
}

main()
