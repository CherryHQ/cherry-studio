/**
 * Quote- and heredoc-aware tokenizer for the built-in Agent's destructive-command guard.
 *
 * The guard must decide on the executable command word, never on text that merely mentions one, so
 * this splits a command line into pipelines of simple commands and separates heredoc bodies from
 * the line that opened them. The caller decides whether a heredoc is fed to an interpreter.
 *
 * A general parser was not used: `bash-parser` is unmaintained (v0.5.0, twenty Babel-6-era
 * dependencies) and `shell-quote` misreads `#`, `$VAR`, backticks, and heredoc bodies. This guard is
 * a usability guard rather than a security boundary, so the conventional forms below are the scope.
 */

export interface ShellCommand {
  /** Basename without `.exe`, lowercased (`C:\Tools\sc.exe` → `sc`). */
  command: string
  /** Arguments after the command word; redirection targets are excluded. */
  args: string[]
  /** Source words preserve empty quoted CMD equality operands. */
  rawArgs?: string[]
  /** Command substitutions found inside the command's words. */
  substitutions: string[]
}

export interface ShellPipeline {
  commands: ShellCommand[]
}

export interface ShellHeredoc {
  delimiter: string
  body: string
  stripTabs: boolean
  /** A quoted delimiter (`<<'EOF'`) suppresses expansions; an unquoted one still evaluates them. */
  quoted: boolean
  /** The physical line that carried the `<<` operator. */
  line: string
}

export interface ParsedShellCommand {
  pipelines: ShellPipeline[]
  heredocs: ShellHeredoc[]
}

const OPERATOR_CHARS = new Set(['&', '|', ';', '(', ')', '<', '>'])
const WHITESPACE = new Set([' ', '\t', '\r'])
const REDIRECTIONS = new Set(['>', '>>', '>|', '&>', '>&', '<', '<<', '<<-', '<<<', '<>'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
/** Keywords and group delimiters that precede a compound command's body (`if … then`, `{ …; }`). */
const RESERVED_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  '{',
  '}',
  '!'
])
/** Wrappers that delegate to the command that follows them. */
const WRAPPERS = new Set([
  'time',
  'nohup',
  'env',
  'command',
  'exec',
  'builtin',
  'xargs',
  'nice',
  'ionice',
  'stdbuf',
  'timeout',
  'doas',
  'sudo',
  'pkexec',
  'busybox',
  'toybox'
])
const WRAPPER_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(['-u', '--user', '-g', '--group', '-p', '--prompt', '-C', '--close-from', '-T', '-r', '-t', '-U']),
  doas: new Set(['-u', '-C']),
  pkexec: new Set(['--user']),
  time: new Set(['-f', '--format', '-o', '--output']),
  exec: new Set(['-a']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '--class', '-n', '--classdata', '-p', '--pid']),
  stdbuf: new Set(['-i', '--input', '-o', '--output', '-e', '--error']),
  xargs: new Set([
    '-n',
    '--max-args',
    '-I',
    '--replace',
    '-P',
    '--max-procs',
    '-L',
    '--max-lines',
    '-s',
    '--max-chars',
    '-d',
    '--delimiter',
    '-E',
    '-e',
    '-a',
    '--arg-file'
  ]),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after'])
}

interface WordToken {
  kind: 'word'
  raw: string
  value: string
  substitutions: string[]
}

interface OperatorToken {
  kind: 'operator'
  value: string
  /** No whitespace before the operator (`2>` is an fd prefix; `2 >` passes an argument). */
  glued: boolean
}

type Token = WordToken | OperatorToken

function isOperatorChar(char: string): boolean {
  return OPERATOR_CHARS.has(char)
}

function normalizeCommandName(word: string): string {
  const base = word.replace(/\\/g, '/').split('/').pop() ?? word
  return base.toLowerCase().replace(/\.exe$/, '')
}

function readOperator(text: string, start: number): { value: string; end: number } {
  const pair = text.slice(start, start + 2)
  if (pair === '<<') {
    const third = text[start + 2]
    if (third === '<') return { value: '<<<', end: start + 3 }
    if (third === '-') return { value: '<<-', end: start + 3 }
  }
  if (['&&', '||', ';;', '>>', '<<', '&>', '>&', '>|', '<&', '<>'].includes(pair)) {
    return { value: pair, end: start + 2 }
  }
  return { value: text[start], end: start + 1 }
}

/** Read a `$(` substitution starting at `start`; returns its body and the index after `)`. */
function readParenthesized(text: string, start: number): { value: string; raw: string; end: number } {
  let index = start + 2
  let depth = 1
  let quote: string | undefined
  const contentStart = index
  while (index < text.length) {
    const char = text[index]
    if (quote) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) quote = undefined
      index++
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      index++
      continue
    }
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0) {
        return { value: text.slice(contentStart, index), raw: text.slice(start, index + 1), end: index + 1 }
      }
    }
    index++
  }
  return { value: text.slice(contentStart), raw: text.slice(start), end: text.length }
}

function readBacktick(text: string, start: number): { value: string; raw: string; end: number } {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '`') {
      return { value: text.slice(start + 1, index), raw: text.slice(start, index + 1), end: index + 1 }
    }
    index++
  }
  return { value: text.slice(start + 1), raw: text.slice(start), end: text.length }
}

function readDoubleQuoted(text: string, start: number): { value: string; substitutions: string[]; end: number } {
  let value = ''
  const substitutions: string[] = []
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '"') return { value, substitutions, end: index + 1 }
    if (char === '\\' && index + 1 < text.length) {
      const next = text[index + 1]
      value += ['$', '`', '"', '\\', '\n'].includes(next) ? next : char + next
      index += 2
      continue
    }
    if (char === '$' && text[index + 1] === '(') {
      const substitution = readParenthesized(text, index)
      substitutions.push(substitution.value)
      value += substitution.raw
      index = substitution.end
      continue
    }
    if (char === '`') {
      const substitution = readBacktick(text, index)
      substitutions.push(substitution.value)
      value += substitution.raw
      index = substitution.end
      continue
    }
    value += char
    index++
  }
  return { value, substitutions, end: index }
}

function readWord(text: string, start: number): { value: string; substitutions: string[]; end: number } {
  let value = ''
  const substitutions: string[] = []
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (WHITESPACE.has(char) || char === '\n' || isOperatorChar(char)) break
    if (char === '\\') {
      if (index + 1 < text.length) value += text[index + 1]
      index += 2
      continue
    }
    if (char === "'") {
      const close = text.indexOf("'", index + 1)
      if (close === -1) {
        value += text.slice(index + 1)
        index = text.length
        break
      }
      value += text.slice(index + 1, close)
      index = close + 1
      continue
    }
    if (char === '"') {
      const quoted = readDoubleQuoted(text, index)
      value += quoted.value
      substitutions.push(...quoted.substitutions)
      index = quoted.end
      continue
    }
    if (char === '$' && text[index + 1] === '(') {
      const substitution = readParenthesized(text, index)
      substitutions.push(substitution.value)
      value += substitution.raw
      index = substitution.end
      continue
    }
    if (char === '`') {
      const substitution = readBacktick(text, index)
      substitutions.push(substitution.value)
      value += substitution.raw
      index = substitution.end
      continue
    }
    value += char
    index++
  }
  return { value, substitutions, end: index }
}

/** `#` starts a comment only at a word boundary; `foo#bar` stays one word. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  let atWordStart = true
  while (index < text.length) {
    const char = text[index]
    if (WHITESPACE.has(char)) {
      index++
      atWordStart = true
      continue
    }
    if (char === '\n') {
      tokens.push({ kind: 'operator', value: '\n', glued: false })
      index++
      atWordStart = true
      continue
    }
    if (char === '#' && atWordStart) {
      while (index < text.length && text[index] !== '\n') index++
      continue
    }
    if (isOperatorChar(char)) {
      const operator = readOperator(text, index)
      tokens.push({ kind: 'operator', value: operator.value, glued: !atWordStart })
      index = operator.end
      atWordStart = true
      continue
    }
    const word = readWord(text, index)
    tokens.push({
      kind: 'word',
      raw: text.slice(index, word.end),
      value: word.value,
      substitutions: word.substitutions
    })
    index = word.end
    atWordStart = false
  }
  return tokens
}

const CMD_COMPARISONS = new Set(['equ', 'neq', 'lss', 'leq', 'gtr', 'geq'])

/** Consume one CMD IF condition without scanning for a deletion word inside its operands. */
function cmdConditionEnd(words: readonly string[], start: number, rawWords?: readonly string[]): number | undefined {
  let index = start
  if (words[index]?.toLowerCase() === '/i') index++
  if (words[index]?.toLowerCase() === 'not') index++
  const condition = words[index]?.toLowerCase()
  if (condition === undefined) return undefined
  if (['exist', 'defined', 'errorlevel', 'cmdextversion'].includes(condition))
    return words[index + 1] === undefined ? undefined : index + 2
  const equalityWord = rawWords?.[index] ?? words[index]
  let quoted = false
  for (let cursor = 0; cursor < equalityWord.length - 1; cursor++) {
    if (equalityWord[cursor] === '"') quoted = !quoted
    if (!quoted && equalityWord[cursor] === '=' && equalityWord[cursor + 1] === '=')
      return index + (cursor + 2 < equalityWord.length ? 1 : 2)
  }
  const nextWord = rawWords?.[index + 1] ?? words[index + 1]
  if (nextWord?.startsWith('==')) return index + (nextWord.length > 2 ? 2 : 3)
  if (CMD_COMPARISONS.has(words[index + 1]?.toLowerCase()) && words[index + 2] !== undefined) return index + 3
  return undefined
}

/**
 * Resolve the command word through assignments, sudo, and wrappers like `xargs`. Also resolves
 * argument vectors that are exec'd as argv rather than re-parsed as shell text (`docker exec …`).
 */
export function resolveCommand(
  words: readonly string[],
  rawWords?: readonly string[]
): { command: string; args: string[]; rawArgs?: string[] } | undefined {
  let index = 0
  while (index < words.length) {
    const word = words[index]
    if (ASSIGNMENT.test(word)) {
      index++
      continue
    }
    const unprefixed = word.replace(/^@+/, '')
    if (unprefixed.length === 0) {
      index++
      continue
    }
    const name = normalizeCommandName(unprefixed)
    if (name === 'if') {
      const end = cmdConditionEnd(words, index + 1, rawWords)
      index = end ?? index + 1
      continue
    }
    if (!WRAPPERS.has(name))
      return { command: name, args: words.slice(index + 1), ...(rawWords && { rawArgs: rawWords.slice(index + 1) }) }
    index++
    // `command -v rm` reports a path; it does not execute.
    if ((name === 'command' || name === 'builtin') && words.slice(index).some((arg) => arg === '-v' || arg === '-V')) {
      return undefined
    }
    while (index < words.length && words[index].startsWith('-') && words[index] !== '-') {
      index += WRAPPER_VALUE_FLAGS[name]?.has(words[index]) ? 2 : 1
    }
    // `timeout 5 rm …` — the first positional argument is the duration.
    if (name === 'timeout' && index < words.length) index++
  }
  return undefined
}

function parseCommands(text: string): ShellPipeline[] {
  const pipelines: ShellPipeline[] = []
  let commands: ShellCommand[] = []
  let words: string[] = []
  let rawWords: string[] = []
  let substitutions: string[] = []
  let redirection: string | undefined

  const flushCommand = () => {
    const resolved = words.length > 0 ? resolveCommand(words, rawWords) : undefined
    // `x=$(rm -f a)` and a bare `> "$(rm -f a)"` run their substitution without ever resolving a
    // command word, so retained substitutions outlive the words they were collected with.
    if (resolved) commands.push({ ...resolved, substitutions })
    else if (substitutions.length > 0) commands.push({ command: '', args: [], substitutions })
    words = []
    rawWords = []
    substitutions = []
  }
  const flushPipeline = () => {
    flushCommand()
    if (commands.length > 0) {
      pipelines.push({ commands })
      commands = []
    }
  }

  const tokens = tokenize(text)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.kind === 'operator') {
      if (token.value === '|') flushCommand()
      else if (!REDIRECTIONS.has(token.value)) flushPipeline()
      redirection = REDIRECTIONS.has(token.value) ? token.value : undefined
      continue
    }
    const next = tokens[index + 1]
    // `2>file` redirects fd 2; `2 >file` passes `2` as an argument.
    if (/^\d+$/.test(token.value) && next?.kind === 'operator' && next.glued && REDIRECTIONS.has(next.value)) {
      continue
    }
    if (redirection !== undefined) {
      const operator = redirection
      redirection = undefined
      substitutions.push(...token.substitutions)
      // `<<<` feeds the word to stdin (`sqlite3 db <<< "DROP TABLE t"`); other targets are filenames.
      if (operator === '<<<') {
        words.push(token.value)
        rawWords.push(token.raw)
      }
      continue
    }
    // A reserved word opens or continues a compound body; the command after it is what executes.
    if (words.length === 0 && token.value.toLowerCase() !== 'if' && RESERVED_WORDS.has(token.value.toLowerCase()))
      continue
    words.push(token.value)
    rawWords.push(token.raw)
    substitutions.push(...token.substitutions)
  }
  flushPipeline()
  return pipelines
}

/** Locate `<<`/`<<-` operators and their delimiters on one line. */
function findHeredocOperators(line: string): Array<{ delimiter: string; stripTabs: boolean; quoted: boolean }> {
  const operators: Array<{ delimiter: string; stripTabs: boolean; quoted: boolean }> = []
  let index = 0
  let quote: string | undefined
  let atWordStart = true
  while (index < line.length) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 2
        continue
      }
      if (char === quote) quote = undefined
      index++
      continue
    }
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      index++
      continue
    }
    if (char === '#' && atWordStart) break
    if (char === '<' && line[index + 1] === '<' && line[index + 2] !== '<') {
      let cursor = index + 2
      let stripTabs = false
      if (line[cursor] === '-') {
        stripTabs = true
        cursor++
      }
      while (line[cursor] === ' ' || line[cursor] === '\t') cursor++
      let delimiter = ''
      let quoted = false
      if (line[cursor] === "'" || line[cursor] === '"') {
        const close = line.indexOf(line[cursor], cursor + 1)
        if (close === -1) break
        delimiter = line.slice(cursor + 1, close)
        quoted = true
        cursor = close + 1
      } else if (line[cursor] === '\\') {
        delimiter = line[cursor + 1] ?? ''
        quoted = true
        cursor += 2
      } else {
        const wordStart = cursor
        while (cursor < line.length && !/[\s;&|()<>]/.test(line[cursor])) cursor++
        delimiter = line.slice(wordStart, cursor)
      }
      if (delimiter) operators.push({ delimiter, stripTabs, quoted })
      index = cursor
      atWordStart = false
      continue
    }
    if (WHITESPACE.has(char) || isOperatorChar(char)) {
      atWordStart = true
      index++
      continue
    }
    atWordStart = false
    index++
  }
  return operators
}

function extractHeredocs(command: string): { commandText: string; heredocs: ShellHeredoc[] } {
  const lines = command.split('\n')
  const kept: string[] = []
  const heredocs: ShellHeredoc[] = []
  const pending: Array<{ delimiter: string; stripTabs: boolean; quoted: boolean; line: string }> = []
  let index = 0
  while (index < lines.length) {
    if (pending.length > 0) {
      const spec = pending.shift()!
      const body: string[] = []
      while (index < lines.length) {
        const candidate = spec.stripTabs ? lines[index].replace(/^\t+/, '') : lines[index]
        index++
        if (candidate === spec.delimiter) break
        body.push(candidate)
      }
      heredocs.push({
        delimiter: spec.delimiter,
        stripTabs: spec.stripTabs,
        quoted: spec.quoted,
        line: spec.line,
        body: body.join('\n')
      })
      continue
    }
    const line = lines[index]
    for (const operator of findHeredocOperators(line)) pending.push({ ...operator, line })
    kept.push(line)
    index++
  }
  return { commandText: kept.join('\n'), heredocs }
}

export function parseShellCommand(command: string): ParsedShellCommand {
  const { commandText, heredocs } = extractHeredocs(command)
  return { pipelines: parseCommands(commandText), heredocs }
}
