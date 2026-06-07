/**
 * One-shot helper: inject passthrough stubs for the @cherrystudio/ui layout
 * primitives into test files that define their own `vi.mock('@cherrystudio/ui', …)`
 * factory (these override the shared mock in tests/renderer.setup.ts, so they break
 * when a migrated component adopts HStack/VStack/etc.).
 *
 * It prepends a spread of a self-contained stub object to the factory's returned
 * object literal; any explicit stubs the test already defines override it.
 *
 * Usage: tsx scripts/codemods/add-ui-layout-stubs-to-mocks.ts --glob "<pattern>" [--apply]
 */

import path from 'node:path'
import process from 'node:process'

import { Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'

const SPREAD_EXPR = `(() => {
    const R = require('react')
    const s =
      (omit: string[] = []) =>
      ({ children, ...p }: any) => {
        for (const k of ['direction', 'align', 'justify', 'gap', 'wrap', 'inline', 'asChild', ...omit]) delete p[k]
        return R.createElement('div', p, children)
      }
    return {
      Box: s(),
      Flex: s(),
      HStack: s(),
      VStack: s(),
      Stack: s(),
      Center: s(),
      Grid: s(['columns', 'flow']),
      PageShell: s(['scroll']),
      Container: s(['size', 'padded', 'fluid']),
      Spacer: s(),
      TruncatingRow: ({ children, leading, trailing, ...p }: any) => {
        for (const k of ['gap', 'align', 'justify', 'wrap', 'asChild']) delete p[k]
        return R.createElement('div', p, leading, children, trailing)
      }
    }
  })()`

function parseArgs(argv: string[]) {
  const globs: string[] = []
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--glob') {
      const v = argv[++i]
      if (v) globs.push(v)
    } else if (argv[i] === '--apply') apply = true
  }
  return { globs, apply }
}

function run() {
  const { globs, apply } = parseArgs(process.argv.slice(2))
  if (!globs.length) {
    console.error('Provide --glob "<pattern>".')
    process.exit(1)
  }
  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single },
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 4 }
  })
  for (const g of globs) project.addSourceFilesAtPaths(path.resolve(process.cwd(), g))

  let patched = 0
  for (const sf of project.getSourceFiles()) {
    const rel = path.relative(process.cwd(), sf.getFilePath())
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== 'vi.mock') continue
      const [arg0, arg1] = call.getArguments()
      if (!arg0 || arg0.getText().replace(/['"]/g, '') !== '@cherrystudio/ui') continue
      if (!arg1 || !Node.isArrowFunction(arg1)) continue
      const body = arg1.getBody()
      let obj: Node | undefined
      if (Node.isParenthesizedExpression(body)) obj = body.getExpression()
      else if (Node.isObjectLiteralExpression(body)) obj = body
      else if (Node.isBlock(body)) {
        const ret = body.getStatements().find((st) => Node.isReturnStatement(st))
        obj = ret && Node.isReturnStatement(ret) ? ret.getExpression() : undefined
      }
      if (!obj || !Node.isObjectLiteralExpression(obj)) {
        console.log(`  SKIP (no object literal): ${rel}`)
        continue
      }
      // idempotency: skip if our stub marker is already present
      if (obj.getText().includes("R.createElement('div', p, children)")) continue
      console.log(`  patch: ${rel}`)
      if (apply) obj.insertSpreadAssignment(0, { expression: SPREAD_EXPR })
      patched++
    }
  }
  if (apply) project.saveSync()
  console.log(`\n${patched} mock(s) ${apply ? 'patched' : '(dry run)'}.`)
}

run()
