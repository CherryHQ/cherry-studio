// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Loose gateway tool definitions may contain missing or non-string names; reject them before building SDK tools.
export function isBlankToolName(name: unknown): boolean {
  return typeof name !== 'string' || name.trim().length === 0
}
