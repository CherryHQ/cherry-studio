import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { __unstable__loadDesignSystem } from 'tailwindcss'
import ts from 'typescript'

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>

type Replacement = {
  start: number
  end: number
  text: string
  count: number
}

type ProcessSummary = {
  scannedFiles: number
  changedFiles: number
  replacements: number
}

export type TailwindCanonicalClassFinding = {
  line: number
  original: string
  canonical: string
  lineText: string
}

type RunCliOptions = {
  cwd?: string
  stdout?: Pick<typeof process.stdout, 'write'>
  stderr?: Pick<typeof process.stderr, 'write'>
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'build', 'v2-refactor-temp', 'resources'])
const CLASS_ATTRIBUTES = new Set(['class', 'className'])
const CANONICALIZE_OPTIONS = { rem: 16, collapse: false, logicalToPhysical: false }

const requireFromCwd = createRequire(`${process.cwd()}${path.sep}`)

function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath)
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function isCnCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === 'cn'
}

function getJsxAttributeName(name: ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`
  return null
}

function escapeTextForQuote(text: string, quote: string): string {
  return text.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)
}

function makeStringReplacement(
  source: string,
  node: ts.StringLiteralLike,
  nextText: string,
  count: number
): Replacement {
  const start = node.getStart()
  const end = node.getEnd()
  const quote = source[start]
  return {
    start: start + 1,
    end: end - 1,
    text: quote === '`' ? nextText.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : escapeTextForQuote(nextText, quote),
    count
  }
}

function canonicalizeClassText(designSystem: DesignSystem, value: string): { text: string; count: number } {
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return { text: value, count: 0 }
  }

  const canonicalTokens = designSystem
    .canonicalizeCandidates(tokens, CANONICALIZE_OPTIONS)
    .map((token, index) => canonicalizeCssVariableToken(tokens[index], token))
  const count = tokens.reduce((total, token, index) => total + (token === canonicalTokens[index] ? 0 : 1), 0)

  return { text: canonicalTokens.join(' '), count }
}

function canonicalizeCssVariableToken(originalToken: string, canonicalToken: string): string {
  const match = originalToken.match(/^(?<prefix>.*-\[)var\((?<variable>--[A-Za-z0-9_-]+)\)\]!?$/)
  if (!match?.groups) return canonicalToken

  const prefix = match.groups.prefix.slice(0, -1)
  const important = originalToken.endsWith('!') ? '!' : ''
  return `${prefix}(${match.groups.variable})${important}`
}

function addLiteralReplacement(
  replacements: Replacement[],
  source: string,
  designSystem: DesignSystem,
  node: ts.StringLiteralLike
): void {
  const result = canonicalizeClassText(designSystem, node.text)
  if (result.count === 0) return

  replacements.push(makeStringReplacement(source, node, result.text, result.count))
}

function getLineNumber(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function collectCanonicalClassFindings(
  findings: TailwindCanonicalClassFinding[],
  source: string,
  sourceFile: ts.SourceFile,
  designSystem: DesignSystem,
  node: ts.StringLiteralLike
): void {
  const tokens = node.text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return

  const canonicalTokens = designSystem
    .canonicalizeCandidates(tokens, CANONICALIZE_OPTIONS)
    .map((token, index) => canonicalizeCssVariableToken(tokens[index], token))

  const line = getLineNumber(sourceFile, node.getStart())
  const lineText = source.split(/\r?\n/)[line - 1]?.trim() ?? ''

  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === canonicalTokens[index]) continue
    findings.push({
      line,
      original: tokens[index],
      canonical: canonicalTokens[index],
      lineText
    })
  }
}

function collectReplacements(source: string, filePath: string, designSystem: DesignSystem): Replacement[] {
  const replacements: Replacement[] = []
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, getScriptKind(filePath))

  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && node.initializer) {
      const attributeName = getJsxAttributeName(node.name)
      if (attributeName && CLASS_ATTRIBUTES.has(attributeName)) {
        if (ts.isStringLiteral(node.initializer)) {
          addLiteralReplacement(replacements, source, designSystem, node.initializer)
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          (ts.isStringLiteral(node.initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))
        ) {
          addLiteralReplacement(replacements, source, designSystem, node.initializer.expression)
        }
      }
    }

    if (ts.isCallExpression(node) && isCnCall(node)) {
      for (const argument of node.arguments) {
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
          addLiteralReplacement(replacements, source, designSystem, argument)
        } else if (ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              property.name &&
              (ts.isStringLiteral(property.name) || ts.isNoSubstitutionTemplateLiteral(property.name))
            ) {
              addLiteralReplacement(replacements, source, designSystem, property.name)
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return replacements
}

export function findTailwindCanonicalClassFindingsInContent(
  content: string,
  filePath: string,
  designSystem: DesignSystem
): TailwindCanonicalClassFinding[] {
  const findings: TailwindCanonicalClassFinding[] = []
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, getScriptKind(filePath))

  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && node.initializer) {
      const attributeName = getJsxAttributeName(node.name)
      if (attributeName && CLASS_ATTRIBUTES.has(attributeName)) {
        if (ts.isStringLiteral(node.initializer)) {
          collectCanonicalClassFindings(findings, content, sourceFile, designSystem, node.initializer)
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          (ts.isStringLiteral(node.initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))
        ) {
          collectCanonicalClassFindings(findings, content, sourceFile, designSystem, node.initializer.expression)
        }
      }
    }

    if (ts.isCallExpression(node) && isCnCall(node)) {
      for (const argument of node.arguments) {
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
          collectCanonicalClassFindings(findings, content, sourceFile, designSystem, argument)
        } else if (ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              property.name &&
              (ts.isStringLiteral(property.name) || ts.isNoSubstitutionTemplateLiteral(property.name))
            ) {
              collectCanonicalClassFindings(findings, content, sourceFile, designSystem, property.name)
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

function applyReplacements(source: string, replacements: Replacement[]): string {
  return replacements
    .toSorted((a, b) => b.start - a.start)
    .reduce((nextSource, replacement) => {
      return `${nextSource.slice(0, replacement.start)}${replacement.text}${nextSource.slice(replacement.end)}`
    }, source)
}

async function resolveStylesheet(id: string, base: string, cwd: string): Promise<string> {
  if (id === 'tailwindcss') {
    return requireFromCwd.resolve('tailwindcss/index.css')
  }

  if (id === 'tw-animate-css') {
    return path.join(cwd, 'node_modules/tw-animate-css/dist/tw-animate.css')
  }

  if (id === '@cherrystudio/ui/styles/theme.css') {
    const sourcePath = path.join(cwd, 'packages/ui/src/styles/theme.css')
    try {
      await fs.access(sourcePath)
      return sourcePath
    } catch {
      return requireFromCwd.resolve(id)
    }
  }

  if (id.startsWith('.')) {
    return path.resolve(base, id)
  }

  return requireFromCwd.resolve(id)
}

export async function loadTailwindDesignSystem(cwd = process.cwd()): Promise<DesignSystem> {
  const entryPath = path.join(cwd, 'src/renderer/src/assets/styles/tailwind.css')
  const css = await fs.readFile(entryPath, 'utf8')

  return __unstable__loadDesignSystem(css, {
    base: path.dirname(entryPath),
    from: entryPath,
    loadStylesheet: async (id, base) => {
      const stylesheetPath = await resolveStylesheet(id, base, cwd)
      return {
        path: stylesheetPath,
        base: path.dirname(stylesheetPath),
        content: await fs.readFile(stylesheetPath, 'utf8')
      }
    }
  })
}

async function listSourceFiles(targetPath: string): Promise<string[]> {
  const stat = await fs.stat(targetPath)

  if (stat.isFile()) {
    return SOURCE_EXTENSIONS.has(path.extname(targetPath)) ? [targetPath] : []
  }

  if (!stat.isDirectory()) {
    return []
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const entryPath = path.join(targetPath, entry.name)
        if (entry.isDirectory()) {
          return IGNORED_DIRS.has(entry.name) ? [] : listSourceFiles(entryPath)
        }

        if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
          return [entryPath]
        }

        return []
      })
  )

  return files.flat()
}

export async function processPath(targetPath: string, designSystem: DesignSystem): Promise<ProcessSummary> {
  const files = await listSourceFiles(targetPath)
  const summary: ProcessSummary = {
    scannedFiles: files.length,
    changedFiles: 0,
    replacements: 0
  }

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8')
    const replacements = collectReplacements(source, filePath, designSystem)
    if (replacements.length === 0) continue

    await fs.writeFile(filePath, applyReplacements(source, replacements))
    summary.changedFiles += 1
    summary.replacements += replacements.reduce((total, replacement) => total + replacement.count, 0)
  }

  return summary
}

function printUsage(stderr: Pick<typeof process.stderr, 'write'>): void {
  stderr.write('Usage: pnpm styles:canonical <path>\n')
}

export async function runCli(argv = process.argv.slice(2), options: RunCliOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  if (argv.length !== 1) {
    printUsage(stderr)
    return 1
  }

  const targetPath = path.resolve(cwd, argv[0])
  try {
    await fs.stat(targetPath)
  } catch {
    stderr.write(`Path does not exist: ${argv[0]}\n`)
    return 1
  }

  const designSystem = await loadTailwindDesignSystem(cwd)
  const summary = await processPath(targetPath, designSystem)
  stdout.write(
    `Tailwind canonical classes: scanned ${summary.scannedFiles} files, changed ${summary.changedFiles} files, fixed ${summary.replacements} classes.\n`
  )

  return 0
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  void runCli()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
