import { describe, expect, it } from 'vitest'

import { getExtensionByLanguage, getLanguageByExtension, getLanguageByFilePath } from '../codeLanguage'

describe('codeLanguage', () => {
  describe('getLanguageByExtension', () => {
    it('returns the conventional primary language for collision-prone extensions', () => {
      // Without overrides, the linguist data picks the alphabetically-first owner —
      // e.g. `.md` → 'GCC Machine Description', `.html` → 'Ecmarkup'.
      expect(getLanguageByExtension('md')).toBe('Markdown')
      expect(getLanguageByExtension('.md')).toBe('Markdown')
      expect(getLanguageByExtension('yml')).toBe('YAML')
      expect(getLanguageByExtension('yaml')).toBe('YAML')
      expect(getLanguageByExtension('html')).toBe('HTML')
      expect(getLanguageByExtension('sql')).toBe('SQL')
      expect(getLanguageByExtension('rs')).toBe('Rust')
      expect(getLanguageByExtension('txt')).toBe('Text')
    })

    it('falls through to the cache for non-overridden extensions', () => {
      expect(getLanguageByExtension('ts')).toBe('TypeScript')
      expect(getLanguageByExtension('json')).toBe('JSON')
      expect(getLanguageByExtension('py')).toBe('Python')
      expect(getLanguageByExtension('go')).toBe('Go')
    })

    it('returns the raw normalized extension when no language claims it', () => {
      expect(getLanguageByExtension('made-up-ext')).toBe('made-up-ext')
    })
  })

  describe('getLanguageByFilePath', () => {
    it('extracts the extension and resolves through the override layer', () => {
      expect(getLanguageByFilePath('README.md')).toBe('Markdown')
      expect(getLanguageByFilePath('config.yml')).toBe('YAML')
      expect(getLanguageByFilePath('src/index.ts')).toBe('TypeScript')
    })
  })

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
