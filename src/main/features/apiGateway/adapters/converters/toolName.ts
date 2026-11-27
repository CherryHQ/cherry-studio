export function isBlankToolName(name: unknown): boolean {
  return typeof name !== 'string' || name.trim().length === 0
}
