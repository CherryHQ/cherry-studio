import { cn } from '@cherrystudio/ui/lib/utils'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import Ansi from 'ansi-to-react'
import type { ComponentPropsWithoutRef } from 'react'
import { memo, useMemo } from 'react'

// ANSI escape codes — 256-color format for theme-specific palettes
const RST = '\x1b[0m'

// Dark theme palette (on #1e1e1e background)
const dark = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[94m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  command: '\x1b[1;92m',
  string: '\x1b[38;5;208m'
}

// Light theme palette (on #f5f5f5 background)
const light = {
  red: '\x1b[38;5;160m',
  yellow: '\x1b[38;5;130m',
  blue: '\x1b[38;5;27m',
  magenta: '\x1b[38;5;127m',
  cyan: '\x1b[38;5;30m',
  gray: '\x1b[38;5;102m',
  command: '\x1b[1;38;5;28m',
  string: '\x1b[38;5;166m'
}

type ColorPalette = typeof dark

const ERROR_LINE_RE = /^(error|Error|ERROR|FAIL|FAILED|fatal|Fatal|FATAL)\b/
const WARNING_LINE_RE = /^(warning|Warning|WARNING|WARN)\b/

const enum TokenType {
  Whitespace,
  String,
  EnvVar,
  Comment,
  LongFlag,
  ShortFlag,
  Operator,
  Path,
  Number,
  Word
}

interface Token {
  type: TokenType
  value: string
}

// Character classification helpers
function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t'
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function isWordChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || isDigit(c)
}

function isOperator(c: string): boolean {
  return c === '|' || c === '&' || c === ';' || c === '>' || c === '<'
}

/**
 * State-machine tokenizer for shell output.
 * Scans character by character, yielding typed tokens.
 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = line.length

  while (i < len) {
    const c = line[i]

    // Whitespace run
    if (isWhitespace(c)) {
      const start = i
      while (i < len && isWhitespace(line[i])) i++
      tokens.push({ type: TokenType.Whitespace, value: line.slice(start, i) })
      continue
    }

    // Single or double quoted string
    if (c === "'" || c === '"') {
      const quote = c
      const start = i
      i++ // skip opening quote
      while (i < len && line[i] !== quote) i++
      if (i < len) i++ // skip closing quote
      tokens.push({ type: TokenType.String, value: line.slice(start, i) })
      continue
    }

    // Environment variable $VAR or ${VAR}
    if (c === '$') {
      const start = i
      i++ // skip $
      if (i < len && line[i] === '{') {
        i++ // skip {
        while (i < len && line[i] !== '}') i++
        if (i < len) i++ // skip }
      } else {
        while (i < len && isWordChar(line[i])) i++
      }
      tokens.push({ type: TokenType.EnvVar, value: line.slice(start, i) })
      continue
    }

    // Comment to end of line
    if (c === '#') {
      tokens.push({ type: TokenType.Comment, value: line.slice(i) })
      break
    }

    // Flags: --long-flag or -x (short flag only if preceded by whitespace/start)
    if (c === '-') {
      const start = i
      if (i + 1 < len && line[i + 1] === '-') {
        // Long flag --xxx
        i += 2
        while (i < len && (isWordChar(line[i]) || line[i] === '-')) i++
        tokens.push({ type: TokenType.LongFlag, value: line.slice(start, i) })
        continue
      }
      // Short flag: only if previous token is whitespace or this is start of line
      const prev = tokens[tokens.length - 1]
      if (
        (!prev || prev.type === TokenType.Whitespace || prev.type === TokenType.Operator) &&
        i + 1 < len &&
        isWordChar(line[i + 1])
      ) {
        tokens.push({ type: TokenType.ShortFlag, value: line.slice(i, i + 2) })
        i += 2
        continue
      }
      // Otherwise treat '-' as start of a word (e.g. middle of hyphenated command)
      const wordStart = i
      i++
      while (i < len && (isWordChar(line[i]) || line[i] === '-')) i++
      tokens.push({ type: TokenType.Word, value: line.slice(wordStart, i) })
      continue
    }

    // Operators: | || && ; > >> < <<
    if (isOperator(c)) {
      const start = i
      i++
      if (i < len && (line[i] === c || (c === '>' && line[i] === '>') || (c === '<' && line[i] === '<'))) {
        i++
      }
      tokens.push({ type: TokenType.Operator, value: line.slice(start, i) })
      continue
    }

    // Path: /... ./... ~/...
    if (
      c === '/' ||
      (c === '.' && i + 1 < len && line[i + 1] === '/') ||
      (c === '~' && i + 1 < len && line[i + 1] === '/')
    ) {
      const start = i
      while (
        i < len &&
        !isWhitespace(line[i]) &&
        line[i] !== "'" &&
        line[i] !== '"' &&
        line[i] !== ',' &&
        !isOperator(line[i])
      ) {
        i++
      }
      tokens.push({ type: TokenType.Path, value: line.slice(start, i) })
      continue
    }

    // Number
    if (isDigit(c)) {
      const start = i
      while (i < len && isDigit(line[i])) i++
      if (i < len && line[i] === '.') {
        i++
        while (i < len && isDigit(line[i])) i++
      }
      // If followed by word chars, it's actually a word (e.g. "0x1f", "3abc")
      if (i < len && isWordChar(line[i])) {
        while (i < len && (isWordChar(line[i]) || line[i] === '-')) i++
        tokens.push({ type: TokenType.Word, value: line.slice(start, i) })
      } else {
        tokens.push({ type: TokenType.Number, value: line.slice(start, i) })
      }
      continue
    }

    // Word (including hyphenated like create-vite, docker-compose)
    if (isWordChar(c)) {
      const start = i
      while (i < len && (isWordChar(line[i]) || line[i] === '-')) i++
      tokens.push({ type: TokenType.Word, value: line.slice(start, i) })
      continue
    }

    // Any other character — emit as a single-char word
    tokens.push({ type: TokenType.Word, value: c })
    i++
  }

  return tokens
}

function colorToken(token: Token, p: ColorPalette): string {
  switch (token.type) {
    case TokenType.Whitespace:
      return token.value
    case TokenType.String:
      return `${p.string}${token.value}${RST}`
    case TokenType.EnvVar:
      return `${p.cyan}${token.value}${RST}`
    case TokenType.Comment:
      return `${p.gray}${token.value}${RST}`
    case TokenType.LongFlag:
    case TokenType.ShortFlag:
      return `${p.magenta}${token.value}${RST}`
    case TokenType.Operator:
      return `${p.gray}${token.value}${RST}`
    case TokenType.Path:
      return `${p.yellow}${token.value}${RST}`
    case TokenType.Number:
      return `${p.blue}${token.value}${RST}`
    case TokenType.Word:
      return token.value
  }
}

function colorizeLine(line: string, commandMode: boolean, p: ColorPalette): string {
  // Full-line comment
  if (line.trimStart().startsWith('#')) {
    return `${p.gray}${line}${RST}`
  }

  // Error / warning lines
  const trimmed = line.trimStart()
  if (ERROR_LINE_RE.test(trimmed)) {
    return `${p.red}${line}${RST}`
  }
  if (WARNING_LINE_RE.test(trimmed)) {
    return `${p.yellow}${line}${RST}`
  }

  const tokens = tokenize(line)
  let expectCommand = commandMode
  let result = ''

  for (const token of tokens) {
    if (token.type === TokenType.Whitespace) {
      result += token.value
    } else if (token.type === TokenType.Operator) {
      result += colorToken(token, p)
      expectCommand = commandMode
    } else if (expectCommand && (token.type === TokenType.Word || token.type === TokenType.Path)) {
      result += `${p.command}${token.value}${RST}`
      expectCommand = false
    } else {
      result += colorToken(token, p)
      expectCommand = false
    }
  }

  return result
}

function colorizeShellOutput(text: string, commandMode: boolean, palette: ColorPalette): string {
  if (text.includes('\x1b[')) return text

  return text
    .split('\n')
    .map((line) => colorizeLine(line, commandMode, palette))
    .join('\n')
}

interface TerminalOutputProps {
  content: string
  commandMode?: boolean
  maxHeight?: string
}

export const TerminalOutput = memo(function TerminalOutput({
  content,
  commandMode = false,
  maxHeight = '15rem'
}: TerminalOutputProps) {
  const { theme } = useTheme()
  const isDark = theme !== ThemeMode.light
  const palette = isDark ? dark : light
  const colorized = useMemo(() => colorizeShellOutput(content, commandMode, palette), [content, commandMode, palette])

  return (
    <TerminalContainer style={{ maxHeight }}>
      <Ansi>{colorized}</Ansi>
    </TerminalContainer>
  )
})

export const TerminalContainer = ({ className, style, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      "m-0 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-[#1e1e1e] px-2.5 py-2 font-['Menlo','Monaco','Courier_New',monospace] text-[#d4d4d4] text-xs leading-normal [&_[role=link]:hover]:text-[#7cb9e8]! [&_[role=link]:hover]:decoration-solid **:[[role=link]]:text-[#569cd6]! **:[[role=link]]:underline **:[[role=link]]:decoration-dotted **:[[role=link]]:underline-offset-2 [&_a:hover]:text-[#7cb9e8]! [&_a:hover]:decoration-solid [&_a]:text-[#569cd6]! [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 in-[[theme-mode=light]]:bg-[#f5f5f5] in-[[theme-mode=light]]:text-[#1e1e1e] [[theme-mode=light]_&_[role=link]:hover]:text-[#0550ae]! [[theme-mode=light]_&_[role=link]]:text-[#0366d6]! [[theme-mode=light]_&_a:hover]:text-[#0550ae]! [[theme-mode=light]_&_a]:text-[#0366d6]!",
      className
    )}
    style={{ maxHeight: '15rem', ...style }}
    {...props}
  />
)
