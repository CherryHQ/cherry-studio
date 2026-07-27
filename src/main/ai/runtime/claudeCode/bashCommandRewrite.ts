import { application } from '@application'
import { Language, type Node, Parser, type Tree } from 'web-tree-sitter'

const MAX_BASH_COMMAND_BYTES = 256 * 1024
const POTENTIAL_PACKAGE_RUNNER_TOKEN = /(?:^|[^A-Za-z0-9_])(?:npx|pipx)(?:$|[^A-Za-z0-9_])/
const NPM_PACKAGE = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+(?:@[A-Za-z0-9._*+~^-]+)?$/
const PYTHON_TOOL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const PYTHON_TOOL_REQUIREMENT =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*\])?(?:==[A-Za-z0-9][A-Za-z0-9.*+!_-]*)?$/

export type BashCommandRewriteResult =
  | { kind: 'unchanged' }
  | { kind: 'rewritten'; command: string; count: number }
  | { kind: 'denied'; reason: string }

type ParserPaths = {
  runtime: string
  bashGrammar: string
}

type ByteEdit = {
  start: number
  end: number
  replacement: Buffer
}

type RewriteTarget = {
  commandNameStart: number
  commandName: string
  argumentPrefix: string[]
}

type Utf8Source = {
  text: string
  buffer: Buffer
  byteOffsets: Uint32Array
}

function getParserPaths(): ParserPaths {
  return {
    runtime: application.getPath('feature.agents.shell_parser.runtime_file'),
    bashGrammar: application.getPath('feature.agents.shell_parser.bash_grammar_file')
  }
}

function createUtf8Source(text: string): Utf8Source {
  // web-tree-sitter's JS/WASM bridge reports UTF-16 string indexes. Normalize
  // every node boundary to a UTF-8 Buffer offset before inspecting or editing
  // bytes; this is what keeps non-ASCII text outside an edit byte-for-byte stable.
  const byteOffsets = new Uint32Array(text.length + 1)
  let byteOffset = 0
  for (let index = 0; index < text.length; ) {
    byteOffsets[index] = byteOffset
    const codePoint = text.codePointAt(index)!
    const codeUnits = codePoint > 0xffff ? 2 : 1
    // A syntax-node boundary cannot split a surrogate pair, but fill the
    // intermediate slot defensively so every Tree-sitter index is mapped.
    if (codeUnits === 2) byteOffsets[index + 1] = byteOffset
    byteOffset += Buffer.byteLength(String.fromCodePoint(codePoint), 'utf8')
    index += codeUnits
    byteOffsets[index] = byteOffset
  }
  return { text, buffer: Buffer.from(text, 'utf8'), byteOffsets }
}

function byteIndex(source: Utf8Source, treeSitterIndex: number): number {
  return source.byteOffsets[treeSitterIndex] ?? source.buffer.length
}

function textOf(source: Utf8Source, node: Node): string {
  return source.buffer.subarray(byteIndex(source, node.startIndex), byteIndex(source, node.endIndex)).toString('utf8')
}

function hasInvalidSyntax(tree: Tree): boolean {
  if (tree.rootNode.hasError) return true
  const pending = [tree.rootNode]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === 'ERROR' || node.isMissing) return true
    pending.push(...node.children)
  }
  return false
}

type PackageRunnerCommandName = {
  node: Node
  value: 'npx' | 'pipx'
}

function getPackageRunnerCommandName(command: Node, source: Utf8Source): PackageRunnerCommandName | null {
  const commandName = command.childForFieldName('name')
  if (!commandName || commandName.type !== 'command_name' || commandName.namedChildCount !== 1) return null
  const word = commandName.namedChild(0)
  if (!word || word.type !== 'word' || word.namedChildCount !== 0) return null
  const value = textOf(source, word)
  return value === 'npx' || value === 'pipx' ? { node: word, value } : null
}

function getArgumentNodes(command: Node): Node[] {
  const arguments_: Node[] = []
  for (let index = 0; index < command.childCount; index++) {
    const child = command.child(index)
    if (child && command.fieldNameForChild(index) === 'argument') arguments_.push(child)
  }
  return arguments_
}

function staticWord(node: Node, source: Utf8Source): string | null {
  if (node.type !== 'word' || node.namedChildCount !== 0) return null
  return textOf(source, node)
}

function analyzeNpxCommand(
  command: Node,
  commandName: Node,
  source: Utf8Source
): { edits: ByteEdit[]; target: RewriteTarget } | { error: string } | null {
  const arguments_ = getArgumentNodes(command)
  const firstArgument = arguments_[0] ? staticWord(arguments_[0], source) : null
  if (
    arguments_.length === 1 &&
    (firstArgument === '--version' || firstArgument === '-v' || firstArgument === '--help' || firstArgument === '-h')
  ) {
    // These inspect npx itself and do not select or execute a package. Preserve
    // them exactly; the runtime may have a system npx even though Cherry does
    // not bundle one, and a package-runner rewrite would change their meaning.
    return null
  }
  const commandNameStart = byteIndex(source, commandName.startIndex)
  const edits: ByteEdit[] = [
    {
      start: commandNameStart,
      end: byteIndex(source, commandName.endIndex),
      replacement: Buffer.from('bun x')
    }
  ]
  let index = 0
  let packageOptionSeen = false
  let executionTargetFound = false

  while (index < arguments_.length && !executionTargetFound) {
    const node = arguments_[index]
    const value = staticWord(node, source)
    if (value === null) {
      return { error: 'npx package and runner arguments must be static, unescaped words' }
    }

    if (value === '-y' || value === '--yes') {
      edits.push({
        start: byteIndex(source, node.startIndex),
        end: byteIndex(source, node.endIndex),
        replacement: Buffer.alloc(0)
      })
      index++
      continue
    }

    if (value === '--no-install') {
      index++
      continue
    }

    if (value === '-p' || value === '--package') {
      if (packageOptionSeen) return { error: 'npx may use at most one -p/--package runner option' }
      const packageNode = arguments_[index + 1]
      const packageName = packageNode ? staticWord(packageNode, source) : null
      if (!packageName || !NPM_PACKAGE.test(packageName)) {
        return { error: 'npx -p/--package requires a static npm package followed by an executable' }
      }
      packageOptionSeen = true
      index += 2
      continue
    }

    if (value.startsWith('-')) {
      return { error: `unsupported npx runner option: ${value}` }
    }

    if (packageOptionSeen) {
      executionTargetFound = true
      break
    }

    if (!NPM_PACKAGE.test(value)) {
      return { error: `unsupported npx package target: ${value}` }
    }
    executionTargetFound = true
  }

  if (!executionTargetFound) {
    return {
      error: packageOptionSeen
        ? 'npx -p/--package requires an executable target'
        : 'npx requires a static npm package target'
    }
  }

  return {
    edits,
    target: { commandNameStart, commandName: 'bun', argumentPrefix: ['x'] }
  }
}

function analyzePipxCommand(
  command: Node,
  commandName: Node,
  source: Utf8Source
): { edits: ByteEdit[]; target: RewriteTarget } | { error: string } | null {
  const arguments_ = getArgumentNodes(command)
  const operation = arguments_[0] ? staticWord(arguments_[0], source) : null
  if (operation !== 'run') return null

  const commandNameStart = byteIndex(source, commandName.startIndex)
  const edits: ByteEdit[] = [
    {
      start: commandNameStart,
      end: byteIndex(source, commandName.endIndex),
      replacement: Buffer.from('uvx')
    },
    {
      start: byteIndex(source, arguments_[0].startIndex),
      end: byteIndex(source, arguments_[0].endIndex),
      replacement: Buffer.alloc(0)
    }
  ]

  const target = arguments_[1] ? staticWord(arguments_[1], source) : null
  if (!target) {
    return { error: 'pipx run requires a static Python tool target' }
  }

  if (target === '--spec') {
    const packageNode = arguments_[2]
    const executableNode = arguments_[3]
    const packageRequirement = packageNode ? staticWord(packageNode, source) : null
    const executable = executableNode ? staticWord(executableNode, source) : null
    if (!packageRequirement || !PYTHON_TOOL_REQUIREMENT.test(packageRequirement) || !executable) {
      return { error: 'pipx run --spec requires a static public package and executable' }
    }
    if (!PYTHON_TOOL_NAME.test(executable)) {
      return { error: `unsupported pipx executable target: ${executable}` }
    }
    edits.push({
      start: byteIndex(source, arguments_[1].startIndex),
      end: byteIndex(source, arguments_[1].endIndex),
      replacement: Buffer.from('--from')
    })
    return {
      edits,
      target: {
        commandNameStart,
        commandName: 'uvx',
        argumentPrefix: ['--from', packageRequirement, executable]
      }
    }
  }

  if (target.startsWith('-')) {
    return { error: `unsupported pipx run option: ${target}` }
  }
  if (!PYTHON_TOOL_NAME.test(target)) {
    return {
      error: `unsupported pipx tool target: ${target}; use \`uvx --from <package> <executable>\` explicitly`
    }
  }

  return {
    edits,
    target: { commandNameStart, commandName: 'uvx', argumentPrefix: [target] }
  }
}

function applyEdits(input: Buffer, edits: ByteEdit[]): Buffer {
  let output = input
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    output = Buffer.concat([output.subarray(0, edit.start), edit.replacement, output.subarray(edit.end)])
  }
  return output
}

function translatedOffset(originalOffset: number, edits: ByteEdit[]): number {
  return (
    originalOffset +
    edits
      .filter((edit) => edit.start < originalOffset)
      .reduce((delta, edit) => delta + edit.replacement.length - (edit.end - edit.start), 0)
  )
}

function verifiesRewrite(tree: Tree, source: Utf8Source, targets: RewriteTarget[], edits: ByteEdit[]): boolean {
  if (hasInvalidSyntax(tree)) return false
  const commands = tree.rootNode.descendantsOfType('command')

  return targets.every((target) => {
    const expectedStart = translatedOffset(target.commandNameStart, edits)
    const command = commands.find((candidate) => {
      const name = candidate.childForFieldName('name')
      return name ? byteIndex(source, name.startIndex) === expectedStart : false
    })
    if (!command) return false
    const commandName = command.childForFieldName('name')
    if (!commandName || textOf(source, commandName) !== target.commandName) return false
    const arguments_ = getArgumentNodes(command)
    return target.argumentPrefix.every(
      (expected, index) => arguments_[index] && staticWord(arguments_[index], source) === expected
    )
  })
}

/**
 * Lazily owns one Bash parser. The parser is a transparent performance cache:
 * every rewrite is still validated against the complete input and output.
 */
export class BashCommandRewriter {
  private parserPromise?: Promise<Parser>

  constructor(private readonly resolvePaths: () => ParserPaths = getParserPaths) {}

  async rewrite(command: string): Promise<BashCommandRewriteResult> {
    if (!POTENTIAL_PACKAGE_RUNNER_TOKEN.test(command)) return { kind: 'unchanged' }

    const input = createUtf8Source(command)
    if (input.buffer.length > MAX_BASH_COMMAND_BYTES) {
      return {
        kind: 'denied',
        reason: 'Bash command containing npx or pipx exceeds the safe rewrite size limit'
      }
    }

    let parser: Parser
    try {
      parser = await this.getParser()
    } catch {
      return {
        kind: 'denied',
        reason: 'The Bash parser could not be initialized; use bundled `bun x` / `uvx` explicitly'
      }
    }

    let tree: Tree | null = null
    let rewrittenTree: Tree | null = null
    try {
      tree = parser.parse(command)
      if (!tree || hasInvalidSyntax(tree)) {
        return {
          kind: 'denied',
          reason: 'Bash syntax containing npx or pipx could not be safely parsed; use `bun x` / `uvx` explicitly'
        }
      }

      const edits: ByteEdit[] = []
      const targets: RewriteTarget[] = []
      for (const commandNode of tree.rootNode.descendantsOfType('command')) {
        const commandName = getPackageRunnerCommandName(commandNode, input)
        if (!commandName) continue
        const analysis =
          commandName.value === 'npx'
            ? analyzeNpxCommand(commandNode, commandName.node, input)
            : analyzePipxCommand(commandNode, commandName.node, input)
        if (!analysis) continue
        if ('error' in analysis) {
          return {
            kind: 'denied',
            reason: `${analysis.error}; use bundled \`bun x\` / \`uvx\` explicitly`
          }
        }
        edits.push(...analysis.edits)
        targets.push(analysis.target)
      }

      if (targets.length === 0) return { kind: 'unchanged' }

      const output = applyEdits(input.buffer, edits)
      const rewritten = output.toString('utf8')
      rewrittenTree = parser.parse(rewritten)
      const rewrittenSource = createUtf8Source(rewritten)
      if (!rewrittenTree || !verifiesRewrite(rewrittenTree, rewrittenSource, targets, edits)) {
        return {
          kind: 'denied',
          reason: 'The rewritten Bash command failed safety validation; use `bun x` / `uvx` explicitly'
        }
      }
      return { kind: 'rewritten', command: rewritten, count: targets.length }
    } catch {
      return {
        kind: 'denied',
        reason: 'Bash syntax containing npx or pipx could not be safely rewritten; use `bun x` / `uvx` explicitly'
      }
    } finally {
      rewrittenTree?.delete()
      tree?.delete()
    }
  }

  private getParser(): Promise<Parser> {
    this.parserPromise ??= this.initializeParser()
    return this.parserPromise
  }

  private async initializeParser(): Promise<Parser> {
    const paths = this.resolvePaths()
    await Parser.init({ locateFile: () => paths.runtime })
    const language = await Language.load(paths.bashGrammar)
    const parser = new Parser()
    parser.setLanguage(language)
    return parser
  }
}

const bashCommandRewriter = new BashCommandRewriter()

export function rewritePackageRunnerCommands(command: string): Promise<BashCommandRewriteResult> {
  return bashCommandRewriter.rewrite(command)
}
