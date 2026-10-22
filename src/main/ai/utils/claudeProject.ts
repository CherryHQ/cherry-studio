const CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH = 200

function claudeProjectDirectoryNameHash(workspacePath: string): string {
  let hash = 0
  for (let index = 0; index < workspacePath.length; index++) {
    hash = ((hash << 5) - hash + workspacePath.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

/** Mirror the Claude Agent SDK cwd-to-project-directory mapping. */
export function claudeProjectDirectoryName(workspacePath: string): string {
  const sanitized = workspacePath.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH) return sanitized
  return `${sanitized.slice(0, CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH)}-${claudeProjectDirectoryNameHash(workspacePath)}`
}
