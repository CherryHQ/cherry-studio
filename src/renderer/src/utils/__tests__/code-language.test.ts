import { describe, expect, it } from 'vitest'

import { getExtensionByLanguage } from '../code-language'

describe('code-language', () => {
  describe('getExtensionByLanguage', () => {
    // 批量测试语言名称到扩展名的映射
    const testLanguageExtensions = (testCases: Record<string, string>) => {
      for (const [language, expectedExtension] of Object.entries(testCases)) {
        const result = getExtensionByLanguage(language)
        expect(result).toBe(expectedExtension)
      }
    }

    it('should return extension for exact language name match', () => {
      testLanguageExtensions({
        '4D': '.4dm',
        'C#': '.cs',
        JavaScript: '.js',
        TypeScript: '.ts',
        'Objective-C++': '.mm',
        Python: '.py',
        SVG: '.svg',
        'Visual Basic .NET': '.vb'
      })
    })

    it('should return extension for case-insensitive language name match', () => {
      testLanguageExtensions({
        '4d': '.4dm',
        'c#': '.cs',
        javascript: '.js',
        typescript: '.ts',
        'objective-c++': '.mm',
        python: '.py',
        svg: '.svg',
        'visual basic .net': '.vb'
      })
    })

    it('should return extension for language aliases', () => {
      testLanguageExtensions({
        js: '.js',
        node: '.js',
        'obj-c++': '.mm',
        'objc++': '.mm',
        'objectivec++': '.mm',
        py: '.py',
        'visual basic': '.vb'
      })
    })

    it('should return fallback extension for unknown languages', () => {
      testLanguageExtensions({
        'unknown-language': '.unknown-language',
        custom: '.custom'
      })
    })

    it('should handle empty string input', () => {
      testLanguageExtensions({
        '': '.'
      })
    })
  })
})
