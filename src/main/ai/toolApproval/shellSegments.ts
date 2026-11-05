export function splitShellSegments(command: string, separator: RegExp, shell: 'bash' | 'powershell'): string[] {
  const segments: string[] = []
  let start = 0
  let quote: "'" | '"' | undefined
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (shell === 'bash' && char === '\\' && quote !== "'") {
      index++
    } else if (shell === 'powershell' && quote !== "'" && char === '`' && command[index + 1]) {
      index++
    } else if (shell === 'powershell' && quote === "'" && char === "'" && command[index + 1] === "'") {
      index++
    } else if (quote) {
      if (char === quote) quote = undefined
    } else if (char === "'" || char === '"') {
      quote = char
    } else {
      const match = separator.exec(command.slice(index))
      if (match?.index === 0) {
        segments.push(command.slice(start, index))
        index += match[0].length - 1
        start = index + 1
      }
    }
  }
  segments.push(command.slice(start))
  return segments
}
