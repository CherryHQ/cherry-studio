export function isBlankToolName(name: string): boolean {
  return typeof name !== 'string' || name.trim().length === 0
}
