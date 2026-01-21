/**
 * Check for hardcoded Chinese/English strings in UI components
 * This script helps identify strings that should be internationalized
 */

import * as fs from 'fs'
import * as path from 'path'

// Configuration
const RENDERER_DIR = path.join(__dirname, '../src/renderer/src')
const MAIN_DIR = path.join(__dirname, '../src/main')
const EXTENSIONS = ['.tsx', '.ts']
const IGNORED_DIRS = ['__tests__', 'node_modules', 'i18n', 'locales', 'types', 'assets']
const IGNORED_FILES = ['*.test.ts', '*.test.tsx', '*.d.ts']

interface Finding {
  file: string
  line: number
  content: string
  type: 'chinese' | 'english'
  source: 'renderer' | 'main'
}

// Patterns for detecting hardcoded strings (shared)
const CHINESE_PATTERNS = [
  // Chinese characters in JSX text content (between > and <)
  { regex: />([^<]*[\u4e00-\u9fff][^<]*)</g, name: 'JSX text content' },
  // Chinese in string attributes
  {
    regex: /(?:placeholder|title|label|message|description|tooltip)=["']([^"']*[\u4e00-\u9fff][^"']*)["']/g,
    name: 'attribute'
  },
  // Chinese in template literals
  { regex: /`[^`]*[\u4e00-\u9fff][^`]*`/g, name: 'template literal' },
  // Chinese in object properties (common UI patterns)
  {
    regex: /(?:message|content|text|title|label|placeholder|description):\s*["']([^"']*[\u4e00-\u9fff][^"']*)["']/g,
    name: 'object property'
  }
]

// Main process specific patterns
const MAIN_CHINESE_PATTERNS = [
  // Dialog options (showOpenDialog, showSaveDialog, showMessageBox)
  {
    regex: /(?:title|message|detail|buttonLabel|defaultPath|name):\s*["']([^"']*[\u4e00-\u9fff][^"']*)["']/g,
    name: 'dialog option'
  },
  // Notification content
  { regex: /(?:body|title):\s*["']([^"']*[\u4e00-\u9fff][^"']*)["']/g, name: 'notification' },
  // Error messages that might be shown to user
  { regex: /new Error\(["']([^"']*[\u4e00-\u9fff][^"']*)["']\)/g, name: 'error message' }
]

const ENGLISH_PATTERNS = [
  // Common UI text patterns in JSX
  { regex: />([A-Z][a-z]+(?:\s+[A-Za-z]+){0,5})</g, name: 'JSX capitalized text' },
  // English text in specific attributes that should be i18n
  { regex: /(?:placeholder|title|label|description)=["']([A-Z][a-zA-Z\s]+)["']/g, name: 'attribute text' }
]

// Patterns to exclude (false positives)
const EXCLUDE_PATTERNS = [
  // Import statements
  /^import\s/,
  // Export statements
  /^export\s/,
  // Comments
  /^\s*\/\//,
  /^\s*\*/,
  /^\s*\/\*/,
  // Console/logger calls (these are for debugging, not UI)
  /console\.(log|error|warn|info|debug|silly|trace)/,
  /logger\.(log|error|warn|info|debug|silly|trace|withContext)/,
  // Type definitions
  /:\s*(string|number|boolean|any)/,
  // React component names
  /<[A-Z][a-zA-Z]*(\s|>|\/)/,
  // CSS class names
  /className=/,
  // Common English words that are technical (not UI text)
  /\b(props|state|default|true|false|null|undefined|return|const|let|var|function|async|await|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|this|super|extends|implements|interface|type|enum|namespace|module|import|export|from|as|of|in|is|typeof|instanceof)\b/i,
  // Test file content
  /describe\(|it\(|test\(|expect\(/,
  // URLs
  /https?:\/\//,
  // File paths
  /\.[a-z]{2,4}$/i,
  // i18n function calls (already internationalized)
  /t\(['"]/,
  /useTranslation/,
  // Provider labels (already handled via getProviderLabel)
  /getProviderLabel/,
  /getMcpProviderDescriptionLabel/,
  // CSS content property (special case, hard to i18n)
  /content:\s*['"][^'"]+['"]/,
  // SVG title elements (usually not user-facing)
  /<title>/,
  // Object values that are sent to API (not displayed in UI)
  /value:\s*['"][^'"]+['"]/,
  // Error messages in catch blocks
  /catch\s*\(/,
  /\.error\(/,
  // Throw statements
  /throw\s+new/
]

function shouldSkipLine(line: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(line))
}

// Remove single-line comment content from a line
function stripSingleLineComment(line: string): string {
  // Handle // comments (but not inside strings)
  // Simple approach: find // that's not inside a string
  const commentIndex = line.indexOf('//')
  if (commentIndex !== -1) {
    // Check if // is inside a string by counting quotes before it
    const beforeComment = line.substring(0, commentIndex)
    const singleQuotes = (beforeComment.match(/'/g) || []).length
    const doubleQuotes = (beforeComment.match(/"/g) || []).length
    const backticks = (beforeComment.match(/`/g) || []).length
    // If all quotes are balanced, the // is not inside a string
    if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0 && backticks % 2 === 0) {
      return line.substring(0, commentIndex)
    }
  }
  return line
}

// Track multi-line comments (both JSX {/* */} and JS /* */)
function isInsideMultiLineComment(lines: string[], lineIndex: number): boolean {
  let inComment = false
  for (let i = 0; i <= lineIndex; i++) {
    const line = lines[i]
    // Check for comment start (both JSX {/* and JS /*)
    if (line.includes('{/*') || line.includes('/*')) {
      inComment = true
    }
    // Check for comment end (both */} and */)
    if (line.includes('*/}') || line.includes('*/')) {
      inComment = false
    }
  }
  return inComment
}

function shouldSkipFile(filePath: string, baseDir: string): boolean {
  const relativePath = path.relative(baseDir, filePath)

  // Skip ignored directories
  if (IGNORED_DIRS.some((dir) => relativePath.includes(dir))) {
    return true
  }

  // Skip ignored file patterns
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

function scanFile(filePath: string, source: 'renderer' | 'main'): Finding[] {
  const findings: Finding[] = []
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  // Select patterns based on source
  const chinesePatterns = source === 'main' ? [...CHINESE_PATTERNS, ...MAIN_CHINESE_PATTERNS] : CHINESE_PATTERNS

  lines.forEach((line, index) => {
    if (shouldSkipLine(line)) {
      return
    }

    // Skip lines inside multi-line comments
    if (isInsideMultiLineComment(lines, index)) {
      return
    }

    // Strip single-line comments before checking
    const strippedLine = stripSingleLineComment(line)

    // Check for Chinese strings
    chinesePatterns.forEach((pattern) => {
      const matches = strippedLine.match(pattern.regex)
      if (matches) {
        findings.push({
          file: filePath,
          line: index + 1,
          content: line.trim(),
          type: 'chinese',
          source
        })
      }
    })

    // Check for English strings (more conservative, renderer only)
    if (source === 'renderer') {
      ENGLISH_PATTERNS.forEach((pattern) => {
        const matches = strippedLine.match(pattern.regex)
        if (matches) {
          // Additional filtering for English to reduce false positives
          const hasMultipleWords = matches.some((m) => {
            const words = m.split(/\s+/)
            return words.length >= 2 && words.length <= 6
          })

          if (hasMultipleWords) {
            findings.push({
              file: filePath,
              line: index + 1,
              content: line.trim(),
              type: 'english',
              source
            })
          }
        }
      })
    }
  })

  return findings
}

function scanDirectory(dir: string, source: 'renderer' | 'main'): Finding[] {
  const findings: Finding[] = []

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        findings.push(...scanDirectory(fullPath, source))
      }
    } else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      if (!shouldSkipFile(fullPath, source === 'renderer' ? RENDERER_DIR : MAIN_DIR)) {
        findings.push(...scanFile(fullPath, source))
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

  // Renderer findings
  if (rendererFindings.length > 0) {
    output += '\n📦 Renderer Process:\n'
    output += '-'.repeat(50) + '\n'

    const rendererChinese = rendererFindings.filter((f) => f.type === 'chinese')
    const rendererEnglish = rendererFindings.filter((f) => f.type === 'english')

    if (rendererChinese.length > 0) {
      output += '\n⚠️ Hardcoded Chinese strings:\n'
      rendererChinese.forEach((f) => {
        const relativePath = path.relative(RENDERER_DIR, f.file)
        output += `\n📍 ${relativePath}:${f.line}\n`
        output += `   ${f.content}\n`
      })
    }

    if (rendererEnglish.length > 0) {
      output += '\n⚠️ Potential hardcoded English strings:\n'
      rendererEnglish.forEach((f) => {
        const relativePath = path.relative(RENDERER_DIR, f.file)
        output += `\n📍 ${relativePath}:${f.line}\n`
        output += `   ${f.content}\n`
      })
    }
  }

  // Main process findings
  if (mainFindings.length > 0) {
    output += '\n📦 Main Process:\n'
    output += '-'.repeat(50) + '\n'

    const mainChinese = mainFindings.filter((f) => f.type === 'chinese')

    if (mainChinese.length > 0) {
      output += '\n⚠️ Hardcoded Chinese strings:\n'
      mainChinese.forEach((f) => {
        const relativePath = path.relative(MAIN_DIR, f.file)
        output += `\n📍 ${relativePath}:${f.line}\n`
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
  console.log('🔍 Scanning for hardcoded strings...\n')

  // Scan both directories
  const rendererFindings = scanDirectory(RENDERER_DIR, 'renderer')
  const mainFindings = scanDirectory(MAIN_DIR, 'main')
  const findings = [...rendererFindings, ...mainFindings]

  const output = formatFindings(findings)

  console.log(output)

  // In strict mode (CI), fail if any Chinese strings are found
  const strictMode = process.env.I18N_STRICT === 'true' || process.argv.includes('--strict')
  const chineseCount = findings.filter((f) => f.type === 'chinese').length

  if (strictMode && chineseCount > 0) {
    console.error('\n❌ Hardcoded Chinese strings detected in strict mode!')
    console.error('Please replace these with i18n keys using the t() function.')
    process.exit(1)
  }

  // Warn mode (default) - just report
  if (findings.length > 0) {
    console.log('\n💡 Tip: Consider replacing these strings with i18n keys.')
    console.log('   Use the t() function from react-i18next for translations.')
  }
}

main()
