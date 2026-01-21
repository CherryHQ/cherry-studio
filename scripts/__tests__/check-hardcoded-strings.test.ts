import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  describe('Pattern matching', () => {
    // Test patterns directly
    const CHINESE_PATTERNS = [
      { regex: />([^<]*[\u4e00-\u9fff][^<]*)</g, name: 'JSX text content' },
      {
        regex: /(?:placeholder|title|label|message|description|tooltip)=["']([^"']*[\u4e00-\u9fff][^"']*)["']/g,
        name: 'attribute'
      }
    ]

    const EXCLUDE_PATTERNS = [
      /console\.(log|error|warn|info|debug|silly|trace)/,
      /logger\.(log|error|warn|info|debug|silly|trace|withContext)/,
      /content:\s*['"][^'"]+['"]/,
      /<title>/,
      /value:\s*['"][^'"]+['"]/,
      /t\(['"]/
    ]

    it('should detect Chinese characters in JSX text content', () => {
      const testLine = '<span>测试文本</span>'
      const matches = testLine.match(CHINESE_PATTERNS[0].regex)
      expect(matches).not.toBeNull()
    })

    it('should detect Chinese characters in placeholder attribute', () => {
      const testLine = 'placeholder="请输入内容"'
      const matches = testLine.match(CHINESE_PATTERNS[1].regex)
      expect(matches).not.toBeNull()
    })

    it('should detect Chinese characters in title attribute', () => {
      const testLine = 'title="提示信息"'
      const matches = testLine.match(CHINESE_PATTERNS[1].regex)
      expect(matches).not.toBeNull()
    })

    it('should exclude logger.silly calls with Chinese', () => {
      const testLine = 'logger.silly(`使用渲染速度: ${renderSpeed}`)'
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(true)
    })

    it('should exclude console.log calls', () => {
      const testLine = 'console.log("调试信息")'
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(true)
    })

    it('should exclude CSS content property', () => {
      const testLine = "content: '点击替换';"
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(true)
    })

    it('should exclude SVG title elements', () => {
      const testLine = '<title>线性单坚果</title>'
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(true)
    })

    it('should exclude object value properties', () => {
      const testLine = "{ label: '吉卜力', value: '吉卜力' }"
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(true)
    })

    it('should exclude lines with t() function calls', () => {
      const testLine = "message={t('common.error')}"
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(true)
    })

    it('should NOT exclude actual UI text that needs i18n', () => {
      const testLine = '<Button>确认</Button>'
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      // This line has Chinese but no exclusion pattern matches
      expect(shouldExclude).toBe(false)
    })

    it('should NOT exclude hardcoded message prop', () => {
      const testLine = 'message="操作成功"'
      const shouldExclude = EXCLUDE_PATTERNS.some((p) => p.test(testLine))
      expect(shouldExclude).toBe(false)
    })
  })

  describe('File filtering', () => {
    const IGNORED_DIRS = ['__tests__', 'node_modules', 'i18n', 'locales', 'types', 'assets']
    const IGNORED_FILES = ['*.test.ts', '*.test.tsx', '*.d.ts']

    const shouldSkipFile = (filePath: string): boolean => {
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
      expect(shouldSkipFile(`${mockSrcDir}/components/Button.test.tsx`)).toBe(true)
      expect(shouldSkipFile(`${mockSrcDir}/utils/helper.test.ts`)).toBe(true)
    })

    it('should skip type definition files', () => {
      expect(shouldSkipFile(`${mockSrcDir}/types/index.d.ts`)).toBe(true)
    })

    it('should skip i18n/locales directories', () => {
      expect(shouldSkipFile(`${mockSrcDir}/i18n/locales/en-us.json`)).toBe(true)
      expect(shouldSkipFile(`${mockSrcDir}/locales/zh-cn.json`)).toBe(true)
    })

    it('should skip __tests__ directories', () => {
      expect(shouldSkipFile(`${mockSrcDir}/components/__tests__/Button.test.tsx`)).toBe(true)
    })

    it('should NOT skip regular component files', () => {
      expect(shouldSkipFile(`${mockSrcDir}/components/Button.tsx`)).toBe(false)
      expect(shouldSkipFile(`${mockSrcDir}/pages/Home.tsx`)).toBe(false)
    })

    it('should NOT skip regular TypeScript files', () => {
      expect(shouldSkipFile(`${mockSrcDir}/utils/helper.ts`)).toBe(false)
    })
  })

  describe('Multi-line comment filtering', () => {
    // Test multi-line comments (both JSX {/* */} and JS /* */)
    const isInsideMultiLineComment = (lines: string[], lineIndex: number): boolean => {
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

    it('should detect start of JSX multi-line comment', () => {
      const lines = [
        'return (',
        '  {/* <Form.Item label="Custom Fact Extraction Prompt" name="customFactExtractionPrompt">',
        '    <Input.TextArea placeholder="Optional custom prompt for fact extraction..." rows={3} />',
        '  </Form.Item> */}',
        ')'
      ]
      expect(isInsideMultiLineComment(lines, 1)).toBe(true)
      expect(isInsideMultiLineComment(lines, 2)).toBe(true)
      expect(isInsideMultiLineComment(lines, 3)).toBe(false) // After closing */}
    })

    it('should NOT mark lines before JSX comment as inside comment', () => {
      const lines = [
        'return (',
        '  <Form.Item label="Visible Label">',
        '  {/* <Form.Item label="Commented Label">',
        '  </Form.Item> */}',
        ')'
      ]
      expect(isInsideMultiLineComment(lines, 0)).toBe(false)
      expect(isInsideMultiLineComment(lines, 1)).toBe(false)
      expect(isInsideMultiLineComment(lines, 2)).toBe(true)
    })

    it('should handle JSX comment on single line', () => {
      const lines = ['{/* This is a single line comment */}', '<span>Real content</span>']
      expect(isInsideMultiLineComment(lines, 0)).toBe(false) // Opens and closes on same line
      expect(isInsideMultiLineComment(lines, 1)).toBe(false)
    })

    it('should handle nested JSX comments correctly', () => {
      const lines = [
        '{/*',
        '  Commented code block',
        '  <Form.Item label="Commented">',
        '*/}',
        '<Form.Item label="Visible">'
      ]
      expect(isInsideMultiLineComment(lines, 1)).toBe(true)
      expect(isInsideMultiLineComment(lines, 2)).toBe(true)
      expect(isInsideMultiLineComment(lines, 4)).toBe(false)
    })

    it('should handle JS multi-line comments', () => {
      const lines = ['/*', ' * This is a JS comment', ' * with multiple lines', ' */', 'const code = true']
      expect(isInsideMultiLineComment(lines, 1)).toBe(true)
      expect(isInsideMultiLineComment(lines, 2)).toBe(true)
      expect(isInsideMultiLineComment(lines, 3)).toBe(false) // After closing */
      expect(isInsideMultiLineComment(lines, 4)).toBe(false)
    })
  })
})
