/**
 * AST-based hardcoded string detection for i18n
 */

import * as fs from 'fs'
import * as path from 'path'
import type { SourceFile } from 'ts-morph'
import { Node, Project } from 'ts-morph'

const RENDERER_DIR = path.join(__dirname, '../src/renderer/src')
const MAIN_DIR = path.join(__dirname, '../src/main')
const EXTENSIONS = ['.tsx', '.ts']
const IGNORED_DIRS = ['__tests__', 'node_modules', 'i18n', 'locales', 'types', 'assets']
const IGNORED_FILES = ['*.test.ts', '*.test.tsx', '*.d.ts', '*prompts*.ts']

// 'content' is handled specially - only checked for specific components
const UI_ATTRIBUTES = [
  'placeholder',
  'title',
  'label',
  'message',
  'description',
  'tooltip',
  'buttonLabel',
  'name',
  'detail',
  'body'
]

const CONTEXT_SENSITIVE_ATTRIBUTES: Record<string, string[]> = {
  content: ['Tooltip', 'Popover', 'Modal', 'Popconfirm', 'Alert', 'Notification', 'Message']
}

const UI_PROPERTIES = ['message', 'text', 'title', 'label', 'placeholder', 'description', 'detail']

interface Finding {
  file: string
  line: number
  content: string
  type: 'chinese' | 'english'
  source: 'renderer' | 'main'
  nodeType: string
}

const CJK_RANGES = [
  '\u3000-\u303f', // CJK Symbols and Punctuation
  '\u3040-\u309f', // Hiragana
  '\u30a0-\u30ff', // Katakana
  '\u3100-\u312f', // Bopomofo
  '\u3400-\u4dbf', // CJK Unified Ideographs Extension A
  '\u4e00-\u9fff', // CJK Unified Ideographs
  '\uac00-\ud7af', // Hangul Syllables
  '\uf900-\ufaff' // CJK Compatibility Ideographs
].join('')

function hasCJK(text: string): boolean {
  return new RegExp(`[${CJK_RANGES}]`).test(text)
}

function hasEnglishUIText(text: string): boolean {
  const words = text.trim().split(/\s+/)
  if (words.length < 2 || words.length > 6) return false
  return /^[A-Z][a-z]+(\s+[A-Za-z]+){1,5}$/.test(text.trim())
}

function createFinding(
  node: Node,
  sourceFile: SourceFile,
  type: 'chinese' | 'english',
  source: 'renderer' | 'main',
  nodeType: string
): Finding {
  return {
    file: sourceFile.getFilePath(),
    line: sourceFile.getLineAndColumnAtPos(node.getStart()).line,
    content: node.getText().slice(0, 100),
    type,
    source,
    nodeType
  }
}

function shouldSkipNode(node: Node): boolean {
  let current: Node | undefined = node

  while (current) {
    const parent = current.getParent()
    if (!parent) break

    if (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent)) {
      return true
    }

    if (Node.isCallExpression(parent)) {
      const callText = parent.getExpression().getText()
      if (/^(logger|console)\.(log|error|warn|info|debug|silly|trace|withContext)/.test(callText)) {
        return true
      }
      const callee = parent.getExpression()
      if (Node.isIdentifier(callee) && callee.getText() === 't') {
        return true
      }
    }

    if (Node.isTypeNode(parent) || Node.isTypeAliasDeclaration(parent) || Node.isInterfaceDeclaration(parent)) {
      return true
    }

    if (Node.isPropertySignature(parent)) {
      return true
    }

    if (Node.isEnumMember(parent)) {
      return true
    }

    // Native language names should stay in native form
    if (Node.isVariableDeclaration(parent)) {
      const varName = parent.getName()
      if (/language|locale/i.test(varName)) {
        return true
      }
    }

    current = parent
  }

  return false
}

function isNonUIString(text: string): boolean {
  if (text.length === 0) return true
  if (/^\d+$/.test(text)) return true
  return false
}

const CODE_CONTEXT = {
  cssTags: /^(css|keyframes|injectGlobal|createGlobalStyle|styled\.\w+)$/,
  cssNames: /style|css|animation/i,
  codeNames: /code|script|python|sql|query|html|template|regex|pattern|shim/i,
  jsxAttrs: new Set(['style', 'css']),
  execCalls: /\.(executeJavaScript|eval|Function|runPython|runPythonAsync)$/
}

function isInCodeContext(node: Node): boolean {
  const parent = node.getParent()
  if (!parent) return false

  if (Node.isTaggedTemplateExpression(parent)) {
    return CODE_CONTEXT.cssTags.test(parent.getTag().getText())
  }

  if (Node.isVariableDeclaration(parent)) {
    const name = parent.getName()
    return CODE_CONTEXT.cssNames.test(name) || CODE_CONTEXT.codeNames.test(name)
  }

  if (Node.isPropertyAssignment(parent)) {
    const name = parent.getName()
    return CODE_CONTEXT.cssNames.test(name) || CODE_CONTEXT.codeNames.test(name)
  }

  if (Node.isJsxExpression(parent)) {
    const attr = parent.getParent()
    if (attr && Node.isJsxAttribute(attr)) {
      return CODE_CONTEXT.jsxAttrs.has(attr.getNameNode().getText())
    }
  }

  // Traverse up for code execution calls (handles string concatenation)
  let current: Node | undefined = parent
  while (current) {
    if (Node.isCallExpression(current)) {
      if (CODE_CONTEXT.execCalls.test(current.getExpression().getText())) {
        return true
      }
      break
    }
    if (!Node.isBinaryExpression(current) && !Node.isParenthesizedExpression(current)) {
      break
    }
    current = current.getParent()
  }

  return false
}

function getJsxElementName(attrNode: Node): string | null {
  const parent = attrNode.getParent()
  if (!parent) return null

  if (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) {
    return parent.getTagNameNode().getText()
  }
  return null
}

function shouldCheckAttribute(attrName: string, elementName: string | null): boolean {
  if (UI_ATTRIBUTES.includes(attrName)) {
    return true
  }
  const allowedComponents = CONTEXT_SENSITIVE_ATTRIBUTES[attrName]
  if (allowedComponents && elementName) {
    return allowedComponents.includes(elementName)
  }
  return false
}

class HardcodedStringDetector {
  private project: Project

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true
    })
  }

  scanFile(filePath: string, source: 'renderer' | 'main'): Finding[] {
    const findings: Finding[] = []

    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath)
      sourceFile.forEachDescendant((node) => {
        this.checkNode(node, sourceFile, source, findings)
      })
      this.project.removeSourceFile(sourceFile)
    } catch (error) {
      console.error(`Error parsing ${filePath}:`, error)
    }

    return findings
  }

  private checkNode(node: Node, sourceFile: SourceFile, source: 'renderer' | 'main', findings: Finding[]): void {
    if (shouldSkipNode(node)) return

    if (Node.isJsxText(node)) {
      const text = node.getText().trim()
      if (text && hasCJK(text)) {
        // Skip SVG internal elements
        const parent = node.getParent()
        if (parent && (Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent))) {
          const tagName = Node.isJsxElement(parent)
            ? parent.getOpeningElement().getTagNameNode().getText()
            : parent.getTagNameNode().getText()
          if (['title', 'desc', 'text', 'tspan'].includes(tagName)) {
            return
          }
        }
        findings.push(createFinding(node, sourceFile, 'chinese', source, 'JsxText'))
      }
    }

    if (Node.isJsxAttribute(node)) {
      const attrName = node.getNameNode().getText()
      const elementName = getJsxElementName(node)

      if (shouldCheckAttribute(attrName, elementName)) {
        const initializer = node.getInitializer()
        if (initializer && Node.isStringLiteral(initializer)) {
          const value = initializer.getLiteralValue()
          if (!isNonUIString(value)) {
            if (hasCJK(value)) {
              findings.push(createFinding(node, sourceFile, 'chinese', source, 'JsxAttribute'))
            } else if (source === 'renderer' && hasEnglishUIText(value)) {
              findings.push(createFinding(node, sourceFile, 'english', source, 'JsxAttribute'))
            }
          }
        }
      }
    }

    if (Node.isStringLiteral(node)) {
      if (isInCodeContext(node)) return

      const value = node.getLiteralValue()
      if (isNonUIString(value)) return

      const parent = node.getParent()

      if (parent && Node.isPropertyAssignment(parent)) {
        const propName = parent.getName()
        if (UI_PROPERTIES.includes(propName)) {
          if (hasCJK(value)) {
            findings.push(createFinding(node, sourceFile, 'chinese', source, 'PropertyAssignment'))
          }
        }
      }

      if (parent && Node.isCallExpression(parent)) {
        const callText = parent.getExpression().getText()
        if (
          /^(window\.toast|message|antdMessage|Modal|notification)\.(success|error|warning|info|confirm)/.test(callText)
        ) {
          if (hasCJK(value)) {
            findings.push(createFinding(node, sourceFile, 'chinese', source, 'CallExpression'))
          }
        }
      }
    }

    if (Node.isTemplateExpression(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      if (isInCodeContext(node)) return

      const text = node.getText()
      if (hasCJK(text)) {
        findings.push(createFinding(node, sourceFile, 'chinese', source, 'TemplateLiteral'))
      }
    }
  }
}

function shouldSkipFile(filePath: string, baseDir: string): boolean {
  const relativePath = path.relative(baseDir, filePath)

  if (IGNORED_DIRS.some((dir) => relativePath.includes(dir))) {
    return true
  }

  const fileName = path.basename(filePath)
  if (
    IGNORED_FILES.some((pattern) => {
      const regex = new RegExp(pattern.replace('*', '.*'))
      return regex.test(fileName)
    })
  ) {
    return true
  }

  return false
}

function scanDirectory(dir: string, source: 'renderer' | 'main', detector: HardcodedStringDetector): Finding[] {
  const findings: Finding[] = []

  if (!fs.existsSync(dir)) {
    return findings
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        findings.push(...scanDirectory(fullPath, source, detector))
      }
    } else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      if (!shouldSkipFile(fullPath, source === 'renderer' ? RENDERER_DIR : MAIN_DIR)) {
        findings.push(...detector.scanFile(fullPath, source))
      }
    }
  }

  return findings
}

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return '✅ No hardcoded strings found!'
  }

  const rendererFindings = findings.filter((f) => f.source === 'renderer')
  const mainFindings = findings.filter((f) => f.source === 'main')
  const chineseFindings = findings.filter((f) => f.type === 'chinese')
  const englishFindings = findings.filter((f) => f.type === 'english')

  let output = ''

  if (rendererFindings.length > 0) {
    output += '\n📦 Renderer Process:\n'
    output += '-'.repeat(50) + '\n'

    const rendererChinese = rendererFindings.filter((f) => f.type === 'chinese')
    const rendererEnglish = rendererFindings.filter((f) => f.type === 'english')

    if (rendererChinese.length > 0) {
      output += '\n⚠️ Hardcoded Chinese strings:\n'
      rendererChinese.forEach((f) => {
        const relativePath = path.relative(RENDERER_DIR, f.file)
        output += `\n📍 ${relativePath}:${f.line} [${f.nodeType}]\n`
        output += `   ${f.content}\n`
      })
    }

    if (rendererEnglish.length > 0) {
      output += '\n⚠️ Potential hardcoded English strings:\n'
      rendererEnglish.forEach((f) => {
        const relativePath = path.relative(RENDERER_DIR, f.file)
        output += `\n📍 ${relativePath}:${f.line} [${f.nodeType}]\n`
        output += `   ${f.content}\n`
      })
    }
  }

  if (mainFindings.length > 0) {
    output += '\n📦 Main Process:\n'
    output += '-'.repeat(50) + '\n'

    const mainChinese = mainFindings.filter((f) => f.type === 'chinese')

    if (mainChinese.length > 0) {
      output += '\n⚠️ Hardcoded Chinese strings:\n'
      mainChinese.forEach((f) => {
        const relativePath = path.relative(MAIN_DIR, f.file)
        output += `\n📍 ${relativePath}:${f.line} [${f.nodeType}]\n`
        output += `   ${f.content}\n`
      })
    }
  }

  output += '\n' + '='.repeat(50) + '\n'
  output += `Total: ${findings.length} potential issues found\n`
  output += `  - Renderer: ${rendererFindings.length} (Chinese: ${rendererFindings.filter((f) => f.type === 'chinese').length}, English: ${rendererFindings.filter((f) => f.type === 'english').length})\n`
  output += `  - Main: ${mainFindings.length} (Chinese: ${mainFindings.length})\n`
  output += `  - Total Chinese: ${chineseFindings.length}\n`
  output += `  - Total English: ${englishFindings.length}\n`

  return output
}

export function main(): void {
  console.log('🔍 Scanning for hardcoded strings using AST analysis...\n')

  const detector = new HardcodedStringDetector()

  const rendererFindings = scanDirectory(RENDERER_DIR, 'renderer', detector)
  const mainFindings = scanDirectory(MAIN_DIR, 'main', detector)
  const findings = [...rendererFindings, ...mainFindings]

  const output = formatFindings(findings)
  console.log(output)

  // Strict mode for CI
  const strictMode = process.env.I18N_STRICT === 'true' || process.argv.includes('--strict')
  const chineseCount = findings.filter((f) => f.type === 'chinese').length

  if (strictMode && chineseCount > 0) {
    console.error('\n❌ Hardcoded Chinese strings detected in strict mode!')
    console.error('Please replace these with i18n keys using the t() function.')
    process.exit(1)
  }

  if (findings.length > 0) {
    console.log('\n💡 Tip: Consider replacing these strings with i18n keys.')
    console.log('   Use the t() function from react-i18next for translations.')
  }
}

export {
  HardcodedStringDetector,
  hasCJK,
  hasEnglishUIText,
  isInCodeContext,
  isNonUIString,
  shouldSkipFile,
  shouldSkipNode,
  UI_ATTRIBUTES,
  UI_PROPERTIES
}

main()
