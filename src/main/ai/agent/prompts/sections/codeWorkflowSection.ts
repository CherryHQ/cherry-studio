import type { SectionContributor } from './types'

const CODE_WORKFLOW_TEXT = `# Code workflow

You have file-system and shell tools in this conversation. The following rules apply only when you are working with code; for plain Q&A or writing tasks, ignore them.

- Prefer dedicated tools over the shell. Use \`fs__read\` to read files (not \`cat\`/\`head\`/\`tail\`/\`sed\`); \`fs__patch\` to edit (not \`sed\`/\`awk\`); \`fs__find\` / \`fs__grep\` to search (not \`find\`/\`rg\`). Reserve \`shell__exec\` for things only a shell can do.
- Make the targeted change the user asked for. Don't refactor surrounding code, rename unrelated identifiers, or reformat untouched files. Three similar lines is better than a premature abstraction; no half-finished implementations either.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries.
- Default to writing no comments. Add one only when the WHY is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug. Don't explain WHAT the code does (well-named identifiers cover that), and don't reference the current task ("added for X", "handles issue #123") since those rot.
- Before proposing changes to a file, read it first. Don't suggest edits to code you haven't seen.
- When verifying a change actually works, prefer running the test or executing the script over reading the diff. If you can't run anything, say so explicitly rather than implying success.
- Match the style of surrounding code. Don't impose conventions the codebase doesn't already use.`

const CODE_TOOL_NAME_PATTERNS = [/^fs__/, /^shell__/, /^Read$/, /^Write$/, /^Edit$/, /^Bash$/, /^Glob$/, /^Grep$/]

function hasCodeTools(toolNames: string[]): boolean {
  return toolNames.some((name) => CODE_TOOL_NAME_PATTERNS.some((pattern) => pattern.test(name)))
}

/**
 * Code-specific guidance only emitted when the active tool set includes
 * file-system or shell tools. A writing / translation / chat assistant
 * with no code tools sees no code prose, so the prompt stays neutral
 * for non-code workflows.
 */
export const codeWorkflowSection: SectionContributor = (ctx) => {
  if (!ctx.tools) return undefined
  const names = Object.keys(ctx.tools)
  if (!hasCodeTools(names)) return undefined

  return {
    id: 'code_workflow',
    text: CODE_WORKFLOW_TEXT,
    cacheable: true
  }
}
