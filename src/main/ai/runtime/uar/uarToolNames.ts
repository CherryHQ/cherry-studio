export function toUarToolName(toolName: string): string {
  const wireName = toolName.startsWith('mcp__') ? toolName.slice(5) : toolName
  return wireName.replace(/[^A-Za-z0-9_-]/g, '_')
}
