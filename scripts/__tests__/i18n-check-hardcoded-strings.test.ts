import { Node, Project } from 'ts-morph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  hasCJK,
  hasEnglishUIText,
  isInCodeContext,
  isNonUIString,
  shouldSkipFile,
  shouldSkipNode
} from '../i18n-check-hardcoded-strings'

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

describe('i18n-check-hardcoded-strings', () => {
  const mockSrcDir = '/mock/src/renderer'

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

  describe('shouldSkipFile', () => {
    // `IGNORED_FILES` holds globs, but they used to be converted with
    // `pattern.replace('*', '.*')` — dots left unescaped and the result
    // unanchored — so `*.d.ts` also matched plain source files whose name
    // happens to contain `d<any>ts` and those files silently left the gate.
    it('skips the file kinds it is meant to skip', () => {
      expect(shouldSkipFile(`${mockSrcDir}/components/Button.test.tsx`, mockSrcDir)).toBe(true)
      expect(shouldSkipFile(`${mockSrcDir}/utils/helper.test.ts`, mockSrcDir)).toBe(true)
      expect(shouldSkipFile(`${mockSrcDir}/types/index.d.ts`, mockSrcDir)).toBe(true)
      expect(shouldSkipFile(`${mockSrcDir}/ai/prompts/coding-prompts.ts`, mockSrcDir)).toBe(true)
    })

    it('keeps skipping everything inside ignored directories', () => {
      expect(shouldSkipFile(`${mockSrcDir}/components/__tests__/Button.tsx`, mockSrcDir)).toBe(true)
      expect(shouldSkipFile(`${mockSrcDir}/i18n/resolver.ts`, mockSrcDir)).toBe(true)
    })

    it('does NOT skip source files whose names merely contain glob fragments', () => {
      expect(shouldSkipFile(`${mockSrcDir}/components/AskUserQuestionCard.tsx`, mockSrcDir)).toBe(false)
      expect(shouldSkipFile(`${mockSrcDir}/components/layout/shared.tsx`, mockSrcDir)).toBe(false)
      expect(shouldSkipFile(`${mockSrcDir}/services/read.ts`, mockSrcDir)).toBe(false)
      expect(shouldSkipFile(`${mockSrcDir}/utils/useLatest.ts`, mockSrcDir)).toBe(false)
      expect(shouldSkipFile(`${mockSrcDir}/utils/prompt.ts`, mockSrcDir)).toBe(false)
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
