const LARK_FORM_SUBMISSION_PATTERN =
  /(?:^|[\s;&|])(?:"[^"\r\n]*lark-cli"|'[^'\r\n]*lark-cli'|[^\s;&|]*lark-cli)\s+base\s+\+form-submit(?:\s|$)/i
const GITHUB_ISSUE_CREATION_PATTERN =
  /(?:^\s*|[;&|]\s*|\r?\n\s*)(?:"(?:[^"\r\n]*[\\/])?gh(?:\.exe)?"|'(?:[^'\r\n]*[\\/])?gh(?:\.exe)?'|(?:[^\s;&|]*[\\/])?gh(?:\.exe)?)\s+issue\s+create(?:\s|$)/i

export function isLarkFormSubmissionCommand(command: string): boolean {
  const normalized = command.replace(/\\\r?\n/g, '').replace(/\^\r?\n|`\r?\n/g, ' ')
  return LARK_FORM_SUBMISSION_PATTERN.test(normalized)
}

export function isGitHubIssueCreationCommand(command: string): boolean {
  const normalized = command.replace(/\\\r?\n/g, '').replace(/\^\r?\n|`\r?\n/g, ' ')
  return GITHUB_ISSUE_CREATION_PATTERN.test(normalized)
}

export function isPermanentDeletionToolName(toolName: string): boolean {
  if (!toolName.startsWith('mcp__')) return false
  const sourceToolName = toolName.split('__').at(-1)?.toLowerCase()
  return ['delete', 'delete_file', 'delete_directory', 'remove_file', 'remove_directory'].includes(sourceToolName ?? '')
}
