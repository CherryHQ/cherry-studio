import * as path from 'path'
import { Node, Project } from 'ts-morph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  HardcodedStringDetector,
  hasCJK,
  hasEnglishUIText,
  isInCodeContext,
  isNonUIString,
  shouldSkipNode
} from '../check-hardcoded-strings'

function createTestProject() {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { jsx: 2 } // React JSX
  })
}

function findStringLiteral(project: Project, code: string, targetString: string): Node | undefined {
  const sourceFile = project.createSourceFile('test.tsx', code, { overwrite: true })
  let found: Node | undefined
  sourceFile.forEachDescendant((node) => {
    if (Node.isStringLiteral(node) && node.getLiteralValue() === targetString) {
      found = node
    }
  })
  return found
}

function findTemplateLiteral(project: Project, code: string): Node | undefined {
  const sourceFile = project.createSourceFile('test.tsx', code, { overwrite: true })
  let found: Node | undefined
  sourceFile.forEachDescendant((node) => {
    if (Node.isNoSubstitutionTemplateLiteral(node) || Node.isTemplateExpression(node)) {
      found = node
    }
  })
  return found
}

// Mock fs module
vi.mock('fs')

describe('check-hardcoded-strings', () => {
  const mockSrcDir = '/mock/src/renderer/src'

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('hasCJK', () => {
    it('should detect Chinese characters', () => {
      expect(hasCJK('测试文本')).toBe(true)
      expect(hasCJK('Hello 世界')).toBe(true)
      expect(hasCJK('中文')).toBe(true)
    })

    it('should detect Japanese characters', () => {
      expect(hasCJK('こんにちは')).toBe(true) // Hiragana
      expect(hasCJK('カタカナ')).toBe(true) // Katakana
      expect(hasCJK('日本語')).toBe(true) // Kanji
    })

    it('should detect Korean characters', () => {
      expect(hasCJK('한국어')).toBe(true) // Hangul
      expect(hasCJK('안녕하세요')).toBe(true)
    })

    it('should return false for non-CJK text', () => {
      expect(hasCJK('Hello World')).toBe(false)
      expect(hasCJK('12345')).toBe(false)
      expect(hasCJK('')).toBe(false)
    })
  })

  describe('hasEnglishUIText', () => {
    it('should detect English UI text patterns', () => {
      expect(hasEnglishUIText('Create New File')).toBe(true)
      expect(hasEnglishUIText('Save As')).toBe(true)
      expect(hasEnglishUIText('Open Project')).toBe(true)
    })

    it('should reject single words', () => {
      expect(hasEnglishUIText('Save')).toBe(false)
      expect(hasEnglishUIText('Cancel')).toBe(false)
    })

    it('should reject lowercase text', () => {
      expect(hasEnglishUIText('create new file')).toBe(false)
      expect(hasEnglishUIText('save as')).toBe(false)
    })

    it('should reject too long phrases', () => {
      expect(hasEnglishUIText('This Is A Very Long Phrase With Many Words')).toBe(false)
    })
  })

  describe('isNonUIString', () => {
    it('should identify empty strings', () => {
      expect(isNonUIString('')).toBe(true)
    })

    it('should identify pure numbers', () => {
      expect(isNonUIString('123')).toBe(true)
      expect(isNonUIString('0')).toBe(true)
      expect(isNonUIString('999')).toBe(true)
    })

    it('should not mark regular UI text as non-UI', () => {
      expect(isNonUIString('Hello World')).toBe(false)
      expect(isNonUIString('Save')).toBe(false)
      expect(isNonUIString('确认')).toBe(false)
      expect(isNonUIString('请输入内容')).toBe(false)
      expect(isNonUIString('-')).toBe(false) // Even short strings may be UI in specific contexts
    })

    it('should not filter technical strings (now handled by AST context)', () => {
      // With AST-based detection, these are no longer filtered
      // because we only check specific UI contexts where they rarely appear
      expect(isNonUIString('./path/to/file')).toBe(false)
      expect(isNonUIString('https://example.com')).toBe(false)
      expect(isNonUIString('#fff')).toBe(false)
      expect(isNonUIString('snake_case_id')).toBe(false)
    })
  })

  describe('File filtering', () => {
    const IGNORED_DIRS = ['__tests__', 'node_modules', 'i18n', 'locales', 'types', 'assets']
    const IGNORED_FILES = ['*.test.ts', '*.test.tsx', '*.d.ts']

    const mockShouldSkipFile = (filePath: string): boolean => {
      const relativePath = filePath.replace(mockSrcDir + '/', '')

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

    it('should skip test files', () => {
      expect(mockShouldSkipFile(`${mockSrcDir}/components/Button.test.tsx`)).toBe(true)
      expect(mockShouldSkipFile(`${mockSrcDir}/utils/helper.test.ts`)).toBe(true)
    })

    it('should skip type definition files', () => {
      expect(mockShouldSkipFile(`${mockSrcDir}/types/index.d.ts`)).toBe(true)
    })

    it('should skip i18n/locales directories', () => {
      expect(mockShouldSkipFile(`${mockSrcDir}/i18n/locales/en-us.json`)).toBe(true)
      expect(mockShouldSkipFile(`${mockSrcDir}/locales/zh-cn.json`)).toBe(true)
    })

    it('should skip __tests__ directories', () => {
      expect(mockShouldSkipFile(`${mockSrcDir}/components/__tests__/Button.test.tsx`)).toBe(true)
    })

    it('should NOT skip regular component files', () => {
      expect(mockShouldSkipFile(`${mockSrcDir}/components/Button.tsx`)).toBe(false)
      expect(mockShouldSkipFile(`${mockSrcDir}/pages/Home.tsx`)).toBe(false)
    })

    it('should NOT skip regular TypeScript files', () => {
      expect(mockShouldSkipFile(`${mockSrcDir}/utils/helper.ts`)).toBe(false)
    })
  })

  describe('HardcodedStringDetector', () => {
    // These are integration tests that would require actual files
    // For unit testing, we test the exported utility functions instead

    it('should be instantiable', () => {
      const detector = new HardcodedStringDetector()
      expect(detector).toBeDefined()
    })
  })

  describe('Legacy pattern compatibility (regex patterns for reference)', () => {
    // Keep legacy pattern tests for backward compatibility reference
    const CHINESE_PATTERNS = [
      { regex: />([^<]*[\u4e00-\u9fff][^<]*)</g, name: 'JSX text content' },
      {
        regex: /(?:placeholder|title|label|message|description|tooltip)=["']([^"']*[\u4e00-\u9fff][^"']*)["']/g,
        name: 'attribute'
      }
    ]

    it('should detect Chinese characters in JSX text content (regex)', () => {
      const testLine = '<span>测试文本</span>'
      const matches = testLine.match(CHINESE_PATTERNS[0].regex)
      expect(matches).not.toBeNull()
    })

    it('should detect Chinese characters in placeholder attribute (regex)', () => {
      const testLine = 'placeholder="请输入内容"'
      const matches = testLine.match(CHINESE_PATTERNS[1].regex)
      expect(matches).not.toBeNull()
    })

    it('should detect Chinese characters in title attribute (regex)', () => {
      const testLine = 'title="提示信息"'
      const matches = testLine.match(CHINESE_PATTERNS[1].regex)
      expect(matches).not.toBeNull()
    })
  })

  describe('shouldSkipNode', () => {
    let project: Project

    beforeEach(() => {
      project = createTestProject()
    })

    it('should skip import declarations', () => {
      const node = findStringLiteral(project, `import { foo } from 'some-module'`, 'some-module')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip export declarations', () => {
      const node = findStringLiteral(project, `export { foo } from 'some-module'`, 'some-module')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip logger calls', () => {
      const node = findStringLiteral(project, `logger.info('测试日志')`, '测试日志')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip console calls', () => {
      const node = findStringLiteral(project, `console.log('测试日志')`, '测试日志')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip t() translation function calls', () => {
      const node = findStringLiteral(project, `t('common.save')`, 'common.save')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip type alias declarations', () => {
      const node = findStringLiteral(project, `type Status = '成功' | '失败'`, '成功')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip interface declarations', () => {
      const node = findStringLiteral(project, `interface Foo { status: '成功' }`, '成功')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip enum members', () => {
      const node = findStringLiteral(project, `enum Status { Success = '成功' }`, '成功')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should skip language/locale variable declarations', () => {
      const node = findStringLiteral(project, `const languageOptions = ['中文', 'English']`, '中文')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(true)
    })

    it('should NOT skip regular string literals', () => {
      const node = findStringLiteral(project, `const message = '测试消息'`, '测试消息')
      expect(node).toBeDefined()
      expect(shouldSkipNode(node!)).toBe(false)
    })
  })

  describe('isInCodeContext', () => {
    let project: Project

    beforeEach(() => {
      project = createTestProject()
    })

    it('should detect tagged template expressions with css tag', () => {
      const node = findTemplateLiteral(project, 'const style = css`color: red;`')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect tagged template expressions with styled tag', () => {
      const node = findTemplateLiteral(project, 'const Button = styled.button`padding: 10px;`')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect CSS variable names', () => {
      const node = findStringLiteral(project, `const customStyle = 'color: blue'`, 'color: blue')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect code variable names', () => {
      const node = findStringLiteral(project, `const pythonCode = 'print("hello")'`, 'print("hello")')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect CSS property assignments', () => {
      const node = findStringLiteral(project, `const obj = { style: 'color: red' }`, 'color: red')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect code property assignments', () => {
      const node = findStringLiteral(project, `const obj = { script: 'console.log(1)' }`, 'console.log(1)')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect JSX style attributes', () => {
      const node = findStringLiteral(project, `<div style={'color: red'} />`, 'color: red')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect executeJavaScript calls', () => {
      const node = findStringLiteral(project, `webview.executeJavaScript('document.title')`, 'document.title')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should detect executeJavaScript with string concatenation', () => {
      const node = findStringLiteral(project, `webview.executeJavaScript('var x = ' + value + ';')`, 'var x = ')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(true)
    })

    it('should NOT detect regular strings', () => {
      const node = findStringLiteral(project, `const message = '普通消息'`, '普通消息')
      expect(node).toBeDefined()
      expect(isInCodeContext(node!)).toBe(false)
    })
  })
})
