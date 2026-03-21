export function getPromptVersionRollbackMarker(
  rollbackFrom: number | null,
  formatRollbackFrom: (rollbackFrom: number) => string
): string | null {
  if (rollbackFrom === null) {
    return null
  }

  return formatRollbackFrom(rollbackFrom)
}
