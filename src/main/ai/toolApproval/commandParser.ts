import path from 'node:path'

import { Language, Parser, type Node } from '@vscode/tree-sitter-wasm'

import { application } from '@application'

export type CommandDialect = 'bash' | 'powershell'
export interface CommandRange {
  start: number
  end: number
  source: number
}
export interface CommandWord {
  raw: string
  value?: string
  quoted: boolean
  range: CommandRange
}
export interface ExecutableCommand {
  id: number
  dialect: CommandDialect
  raw: string
  range: CommandRange
  pipeline: string
  words: CommandWord[]
  controls: string[]
  substitutions: string[]
  assignments?: CommandWord[]
  functionSource?: string
}
export interface CommandRedirection {
  raw: string
  range: CommandRange
  target?: CommandWord
  operator: string
  pipeline: string
}
export interface CommandHeredoc {
  owner?: number
  delimiter: string
  body: string
  quoted: boolean
  stripTabs: boolean
  line: string
  pipeline: string
  range: CommandRange
}
export interface CommandAnalysis {
  sources: { text: string; dialect?: CommandDialect; origin?: CommandRange }[]
  commands: ExecutableCommand[]
  redirections: CommandRedirection[]
  heredocs: CommandHeredoc[]
  diagnostics: { reason: string; range: CommandRange }[]
}

const MAX_INPUT = 65_536
const MAX_NODES = 10_000
const MAX_TREE_DEPTH = 128
export const MAX_COMMAND_NESTING = 8
let languages: Record<CommandDialect, Language> | undefined
let initialization: Promise<void> | undefined

export function getShellDialect(shellPath?: string): string {
  const name = shellPath
    ?.replace(/\\/g, '/')
    .split('/')
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, '')
  if (!name || ['bash', 'sh', 'dash'].includes(name)) return 'bash'
  return ['pwsh', 'powershell'].includes(name) ? 'powershell' : name
}

/** Grammar tables are immutable; each invocation disposes its own parser and syntax tree. */
export function initializeCommandParser(): Promise<void> {
  initialization ??= (async () => {
    const assets = application.getPath('feature.agents.command_parser_assets')
    await Parser.init({ locateFile: (filename: string) => path.join(assets, filename) })
    const [bash, powershell] = await Promise.all([
      Language.load(path.join(assets, 'tree-sitter-bash.wasm')),
      Language.load(path.join(assets, 'tree-sitter-powershell.wasm'))
    ])
    languages = { bash, powershell }
  })()
  return initialization
}

function children(node: Node): Node[] {
  return node.namedChildren.filter((child): child is Node => child !== null)
}

function descendants(node: Node, predicate: (candidate: Node) => boolean): Node[] {
  const result: Node[] = []
  const pending = [node]
  let visited = 0
  while (pending.length && visited++ < MAX_NODES) {
    const current = pending.pop()!
    if (predicate(current)) result.push(current)
    pending.push(...children(current))
  }
  return result
}

function decodeWord(node: Node, dialect: CommandDialect, source: number): CommandWord {
  const raw = node.text
  const quoted = /^['"]/.test(raw) || raw.startsWith("$'")
  const range = { start: node.startIndex, end: node.endIndex, source }
  const dynamic =
    descendants(node, (part) =>
      /^(?:variable|expansion|simple_expansion|command_substitution|process_substitution|arithmetic_expansion|sub_expression|member_access|invokation_expression)$/.test(
        part.type
      )
    ).length > 0
  if (
    (dialect === 'powershell' && (raw.match(/`+$/)?.[0].length ?? 0) % 2 === 1) ||
    dynamic ||
    (dialect === 'bash' && !quoted && /(^|[^\\])[*?[]/.test(raw))
  )
    return { raw, quoted, range }
  let value = raw
  if (dialect === 'powershell') {
    if (raw.startsWith("'") && raw.endsWith("'")) value = raw.slice(1, -1).replace(/''/g, "'")
    else {
      if (raw.startsWith('"') && raw.endsWith('"')) value = raw.slice(1, -1)
      value = value
        .replace(/`\r?\n/g, '')
        .replace(/`(.)/gs, (_, char: string) => ({ n: '\n', r: '\r', t: '\t' })[char] ?? char)
    }
  } else if (node.type === 'concatenation') {
    const parts = children(node).map((child) => decodeWord(child, dialect, source).value)
    if (parts.some((part) => part === undefined)) return { raw, quoted, range }
    value = parts.join('')
  } else if (raw.startsWith("'") && raw.endsWith("'")) value = raw.slice(1, -1)
  else if (raw.startsWith('"') && raw.endsWith('"'))
    value = raw
      .slice(1, -1)
      .replace(/\\\n/g, '')
      .replace(/\\([$`"\\])/g, '$1')
  else if (raw.startsWith("$'")) {
    value = raw
      .slice(2, -1)
      .replace(
        /\\(x[\da-fA-F]{1,2}|u[\da-fA-F]{1,4}|U[\da-fA-F]{1,8}|[0-7]{1,3}|c.|[abefnrtv'"\\\n])/g,
        (_, escape: string) => {
          if (/^[xuU]/.test(escape)) {
            const code = Number.parseInt(escape.slice(1), 16)
            return code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'
          }
          if (/^[0-7]/.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8) % 256)
          if (escape.startsWith('c')) return String.fromCharCode(escape.charCodeAt(1) & 31)
          return (
            { a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\n': '' }[escape] ?? escape
          )
        }
      )
  } else value = raw.replace(/\\\r?\n/g, '').replace(/\\(.)/gs, '$1')
  return { raw, value, quoted, range }
}

/** Parses syntax without executing input. Call initializeCommandParser before the synchronous bridge. */
export function parseCommandSyntax(text: string, dialect: CommandDialect, source = 0): CommandAnalysis {
  if (!languages) throw new Error('Command parser has not been initialized')
  const result: CommandAnalysis = {
    sources: [{ text, dialect }],
    commands: [],
    redirections: [],
    heredocs: [],
    diagnostics: []
  }
  const range = (node: Node): CommandRange => ({ start: node.startIndex, end: node.endIndex, source })
  const diagnostic = (reason: string, at: CommandRange) => result.diagnostics.push({ reason, range: at })
  if (text.length > MAX_INPUT) {
    diagnostic('input-limit', { start: 0, end: text.length, source })
  }
  const parser = new Parser()
  parser.setLanguage(languages[dialect])
  const deadline = performance.now() + 200
  const tree = parser.parse(text.slice(0, MAX_INPUT), undefined, {
    progressCallback: () => performance.now() > deadline
  })
  if (!tree) {
    parser.delete()
    diagnostic('parse-limit', { start: 0, end: text.length, source })
    return result
  }
  let nodes = 0
  try {
    const walk = (
      node: Node,
      pipeline: string,
      controls: string[],
      depth: number,
      functionSource?: string,
      heredocPipeline = false
    ) => {
      if (++nodes > MAX_NODES || depth > MAX_TREE_DEPTH) {
        if (!result.diagnostics.some(({ reason }) => reason === 'node-limit')) diagnostic('node-limit', range(node))
        return
      }
      if (node.type === 'function_definition') functionSource = node.text
      if (node.type === 'heredoc_redirect') heredocPipeline = true
      if (node.type === 'command_substitution' || node.type === 'process_substitution') {
        pipeline = `${source}:root`
        controls = [...controls, node.type]
        heredocPipeline = false
      }
      if (node.isError || node.isMissing) diagnostic('syntax-error', range(node))
      if ((node.type === 'pipeline' || node.type === 'pipeline_chain') && !heredocPipeline)
        pipeline = `${source}:${node.startIndex}`
      if (pipeline === `${source}:root` && (node.type === 'command' || node.type === 'redirected_statement'))
        pipeline = `${source}:statement:${node.startIndex}`
      if (node.type === 'list')
        controls = [
          ...controls,
          ...node.children
            .filter((part) => part && !part.isNamed && ['&&', '||'].includes(part.text))
            .map((part) => part!.text)
        ]
      if (
        /^(?:list|if_statement|while_statement|for_statement|function_definition|subshell|compound_statement|try_statement|script_block)$/.test(
          node.type
        )
      )
        controls = [...controls, node.type]
      if (node.type === 'command' && !node.hasError && (text.length <= MAX_INPUT || node.endIndex < MAX_INPUT)) {
        const name = node.childForFieldName(dialect === 'bash' ? 'name' : 'command_name')
        const elements = node.childForFieldName('command_elements')
        const arguments_ =
          dialect === 'bash'
            ? node.childrenForFieldName('argument').filter((child): child is Node => child !== null)
            : (elements?.namedChildren
                .filter((child): child is Node => child !== null)
                .filter((child) => child.type !== 'command_argument_sep') ?? [])
        if (name) {
          const words = [name, ...arguments_].map((part) => decodeWord(part, dialect, source))
          if (words[0].value === undefined) diagnostic('dynamic-executable', words[0].range)
          result.commands.push({
            id: result.commands.length,
            dialect,
            raw: node.text,
            range: range(node),
            pipeline,
            words,
            controls,
            assignments: children(node)
              .filter((part) => part.type === 'variable_assignment')
              .map((part) => decodeWord(part, dialect, source)),
            ...(functionSource ? { functionSource } : {}),
            substitutions: descendants(node, (part) => part.type === 'command_substitution').map((part) =>
              part.text.startsWith('$(') ? part.text.slice(2, -1) : part.text.slice(1, -1)
            )
          })
        } else diagnostic('unsupported-command', range(node))
      }
      if (node.type === 'file_redirect' || node.type === 'redirection' || node.type === 'herestring_redirect') {
        const owner = node.parent?.childForFieldName('body')
        const redirectPipeline = owner?.type === 'pipeline' ? `${source}:${owner.startIndex}` : pipeline
        const destination = node.childForFieldName('destination') ?? children(node).at(-1)
        const operator =
          node.children.filter((child): child is Node => child !== null).find((child) => !child.isNamed)?.text ??
          node.text.split(/\s/)[0]
        result.redirections.push({
          raw: node.text,
          range: range(node),
          operator,
          pipeline: redirectPipeline,
          ...(destination ? { target: decodeWord(destination, dialect, source) } : {})
        })
      }
      if (node.type === 'heredoc_redirect') {
        const owner = node.parent?.childForFieldName('body')
        const redirectPipeline = owner?.type === 'pipeline' ? `${source}:${owner.startIndex}` : pipeline
        const start = children(node).find((child) => child.type === 'heredoc_start')
        const body = children(node).find((child) => child.type === 'heredoc_body')
        if (start && body) {
          const lineStart = text.lastIndexOf('\n', node.startIndex) + 1
          const lineEnd = text.indexOf('\n', node.startIndex)
          result.heredocs.push({
            owner: owner?.type === 'command' ? owner.startIndex : undefined,
            delimiter: start.text.replace(/['"\\]/g, ''),
            body: body.text,
            quoted: /['"\\]/.test(start.text),
            stripTabs: node.text.startsWith('<<-'),
            line: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd),
            range: range(node),
            pipeline: redirectPipeline
          })
        }
      }
      if (
        dialect === 'powershell' &&
        /(?:invokation_expression|assignment_expression|script_block_expression)/.test(node.type)
      )
        diagnostic('dynamic-executable-input', range(node))
      for (const child of children(node)) walk(child, pipeline, controls, depth + 1, functionSource, heredocPipeline)
    }
    walk(tree.rootNode, `${source}:root`, [], 0)
  } finally {
    tree.delete()
    parser.delete()
  }
  return result
}

export async function parseCommand(text: string, dialect: CommandDialect): Promise<CommandAnalysis> {
  await initializeCommandParser()
  return parseCommandSyntax(text, dialect)
}
