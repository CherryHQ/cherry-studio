import {
  AGENTS_SKILLS_GITIGNORE,
  buildAgentsSkillsGitignore,
  buildClaudeSkillsGitignore,
  CLAUDE_SKILLS_GITIGNORE,
  listSkillNames,
  writeFileIfChanged
} from './skills-common'

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

  if (writeFileIfChanged(AGENTS_SKILLS_GITIGNORE, agentsGitignore)) {
    changedFiles.push('.agents/skills/.gitignore')
  }
  if (writeFileIfChanged(CLAUDE_SKILLS_GITIGNORE, claudeGitignore)) {
    changedFiles.push('.claude/skills/.gitignore')
  }

  if (changedFiles.length === 0) {
    console.log(`skills:sync up-to-date (${skillNames.length} public skill${skillNames.length === 1 ? '' : 's'})`)
    return
  }

  console.log(`skills:sync updated ${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'}:`)
  for (const file of changedFiles) {
    console.log(`- ${file}`)
  }
}

main()
