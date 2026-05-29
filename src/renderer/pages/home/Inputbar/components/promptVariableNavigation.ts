const PROMPT_VARIABLE_PATTERN = /\$\{[^}]+\}/

export type PromptVariableRange = {
  start: number
  end: number
}

export function findNextPromptVariableRange(
  text: string,
  cursorPosition: number,
  selectionLength: number
): PromptVariableRange | null {
  const searchStart = Math.max(0, Math.min(cursorPosition + selectionLength, text.length))
  const nextMatch = text.slice(searchStart).match(PROMPT_VARIABLE_PATTERN)

  if (nextMatch?.index !== undefined) {
    const start = searchStart + nextMatch.index
    return { start, end: start + nextMatch[0].length }
  }

  const firstMatch = text.match(PROMPT_VARIABLE_PATTERN)
  if (firstMatch?.index === undefined) {
    return null
  }

  return { start: firstMatch.index, end: firstMatch.index + firstMatch[0].length }
}
