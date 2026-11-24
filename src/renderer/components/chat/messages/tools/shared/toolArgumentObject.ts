// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This proves only an opaque argument container; its tool-owned fields remain unvalidated.
export function isToolArgumentObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Streamed and stored arguments are unparsed; project only this field without changing whitespace or rejecting valid siblings.
export function readToolStringArgument(input: unknown, key: string): string | undefined {
  if (!isToolArgumentObject(input)) return undefined
  const value = input[key]

  return typeof value === 'string' ? value : undefined
}
