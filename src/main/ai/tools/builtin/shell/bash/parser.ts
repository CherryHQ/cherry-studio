import bashGrammarPath from 'tree-sitter-bash/tree-sitter-bash.wasm?asset'
import { Language, type Node, Parser } from 'web-tree-sitter'

export type SimpleCommand = {
  /** Executable name as it appears in source (`git`, `nice`, `./script.sh`). */
  name: string
  /** Argument tokens, in source order, with quoting structure preserved as text. */
  args: string[]
  /** Source byte offsets, useful for error messages. */
  start: number
  end: number
}

export type BashAst = {
  /** Every simple command, including ones inside `$(...)` / pipelines / `&&` chains. */
  commands: SimpleCommand[]
  hasCommandSubstitution: boolean
  hasRedirection: boolean
  /** ERROR/MISSING node, empty input, or other unresolvable structure. */
  hasUnknown: boolean
  source: string
}

let cachedParser: Parser | null = null
let initPromise: Promise<Parser> | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser
  if (initPromise) return initPromise
  initPromise = (async () => {
    await Parser.init()
    const language = await Language.load(bashGrammarPath)
    const parser = new Parser()
    parser.setLanguage(language)
    cachedParser = parser
    return parser
  })()
  return initPromise
}

export async function parseBashCommand(source: string): Promise<BashAst> {
  if (source.trim() === '') {
    return { commands: [], hasCommandSubstitution: false, hasRedirection: false, hasUnknown: true, source }
  }

  const parser = await getParser()
  const tree = parser.parse(source)
  if (!tree) {
    return { commands: [], hasCommandSubstitution: false, hasRedirection: false, hasUnknown: true, source }
  }

  const commands: SimpleCommand[] = []
  let hasCommandSubstitution = false
  let hasRedirection = false
  let hasUnknown = tree.rootNode.hasError

  walk(tree.rootNode, (node) => {
    if (node.isMissing || node.type === 'ERROR') {
      hasUnknown = true
      return
    }
    switch (node.type) {
      case 'command': {
        const cmd = extractCommand(node)
        if (cmd) commands.push(cmd)
        else hasUnknown = true
        return
      }
      case 'command_substitution':
        hasCommandSubstitution = true
        return
      case 'file_redirect':
      case 'heredoc_redirect':
      case 'herestring_redirect':
        hasRedirection = true
        return
    }
  })

  if (commands.length === 0) hasUnknown = true

  return { commands, hasCommandSubstitution, hasRedirection, hasUnknown, source }
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) walk(child, visit)
  }
}

function extractCommand(commandNode: Node): SimpleCommand | null {
  const nameNode = commandNode.childForFieldName('name')
  if (!nameNode) return null
  const name = nameNode.text
  const args: string[] = []
  for (let i = 0; i < commandNode.namedChildCount; i++) {
    const child = commandNode.namedChild(i)
    if (!child) continue
    if (child.id === nameNode.id) continue
    // Skip nested commands inside `$(...)` — those are walked separately
    // by `walk()`. Skip redirections — they're emitted as a separate flag.
    if (child.type === 'command_substitution' || child.type === 'process_substitution') continue
    if (child.type === 'file_redirect' || child.type === 'heredoc_redirect' || child.type === 'herestring_redirect') {
      continue
    }
    args.push(child.text)
  }
  return { name, args, start: commandNode.startIndex, end: commandNode.endIndex }
}
