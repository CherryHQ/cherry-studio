function scanShellSegments(command: string, separator: RegExp, shell: 'bash' | 'powershell') {
  const segments: string[] = []
  let start = 0
  let escapedIndex = -1
  let quote: "'" | '"' | undefined
  const contexts: Array<{ closing: ')' | '}' | '`'; quote: typeof quote; literal?: boolean }> = []
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (shell === 'bash' && char === '\\' && quote !== "'") {
      escapedIndex = index + 1
      index++
    } else if (shell === 'powershell' && quote !== "'" && char === '`' && command[index + 1]) {
      index++
    } else if (shell === 'powershell' && quote === "'" && char === "'" && command[index + 1] === "'") {
      index++
    } else if (quote !== "'" && char === '$' && ['(', '{'].includes(command[index + 1])) {
      contexts.push({
        closing: command[index + 1] === '(' ? ')' : '}',
        quote,
        literal: command[index + 1] === '{' && (quote === '"' || contexts.at(-1)?.literal === true)
      })
      quote = undefined
      index++
    } else if (shell === 'bash' && quote !== "'" && char === '`') {
      if (contexts.at(-1)?.closing === '`' && !quote) {
        quote = contexts.pop()!.quote
      } else {
        contexts.push({ closing: '`', quote })
        quote = undefined
      }
    } else if (contexts.at(-1)?.literal) {
      if (char === '}') quote = contexts.pop()!.quote
    } else if (quote) {
      if (char === quote) quote = undefined
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '(') {
      contexts.push({ closing: ')', quote })
      quote = undefined
    } else if (char === ')' || char === '}') {
      if (contexts.at(-1)?.closing === char) {
        quote = contexts.pop()!.quote
      }
    } else if (char === '#' && (index === 0 || (escapedIndex !== index - 1 && /[\s;&|()]/.test(command[index - 1])))) {
      while (index + 1 < command.length && command[index + 1] !== '\n') index++
    } else {
      const match = separator.exec(command.slice(index))
      if (match?.index === 0) {
        segments.push(command.slice(start, index))
        start = index + match[0].length
        index += Math.max(match[0].length - 1, 0)
      }
    }
  }
  segments.push(command.slice(start))
  return { segments, ambiguous: quote !== undefined || contexts.length > 0 }
}

export function splitShellSegments(command: string, separator: RegExp, shell: 'bash' | 'powershell'): string[] {
  return scanShellSegments(command, separator, shell).segments
}

export function hasAmbiguousShellSyntax(command: string, shell: 'bash' | 'powershell'): boolean {
  return scanShellSegments(command, /^(?:&&|\|\||[&;\n|])/, shell).ambiguous
}
