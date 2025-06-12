import { splitToSubTrunks } from '@renderer/services/ShikiStreamTokenizer'
import type { ThemedToken } from 'shiki/types'
import { describe, expect, it } from 'vitest'

import { getReactStyleFromToken } from '../shiki'

// FontStyle 常量，避免类型错误
const FS_ITALIC = 1
const FS_BOLD = 2
const FS_UNDERLINE = 4

/**
 * 创建 ThemedToken 对象的辅助函数
 * 只需提供测试所需的字段，其余字段使用默认值
 */
function createThemedToken(partial: Partial<ThemedToken> = {}): ThemedToken {
  return {
    content: 'default-content',
    offset: 0,
    ...partial
  }
}

describe('shiki', () => {
  describe('splitToSubTrunks', () => {
    it('should return the original string when there is no newline', () => {
      const chunk = 'console.log("Hello world")'
      const result = splitToSubTrunks(chunk)
      expect(result).toEqual([chunk])
    })

    it('should split string with one newline into two parts', () => {
      const chunk = 'const x = 5;\nconsole.log(x)'
      const result = splitToSubTrunks(chunk)
      expect(result).toEqual(['const x = 5;', 'console.log(x)'])
    })

    it('should split by the last newline when multiple newlines exist', () => {
      const chunk = 'const x = 5;\nconst y = 10;\nconsole.log(x + y)'
      const result = splitToSubTrunks(chunk)
      expect(result).toEqual(['const x = 5;\nconst y = 10;', 'console.log(x + y)'])
    })

    it('should handle string ending with a newline', () => {
      const chunk = 'const x = 5;\nconst y = 10;\n'
      const result = splitToSubTrunks(chunk)
      expect(result).toEqual(['const x = 5;\nconst y = 10;', ''])
    })

    it('should handle empty string', () => {
      const chunk = ''
      const result = splitToSubTrunks(chunk)
      expect(result).toEqual([''])
    })
  })

  describe('getReactStyleFromToken', () => {
    it('should get styles from token htmlStyle', () => {
      const token = createThemedToken({
        content: 'test',
        htmlStyle: {
          'font-style': 'italic',
          'font-weight': 'bold',
          'background-color': '#f5f5f5',
          'text-decoration': 'underline',
          color: '#ff0000'
        }
      })

      const result = getReactStyleFromToken(token)

      expect(result).toEqual({
        fontStyle: 'italic',
        fontWeight: 'bold',
        backgroundColor: '#f5f5f5',
        textDecoration: 'underline',
        color: '#ff0000'
      })
    })

    it('should use getTokenStyleObject when htmlStyle is not available', () => {
      const token = createThemedToken({
        content: 'test',
        color: '#ff0000',
        fontStyle: FS_ITALIC
      })

      const result = getReactStyleFromToken(token)

      expect(result).toEqual({
        fontStyle: 'italic',
        color: '#ff0000'
      })
    })

    it('should properly convert all CSS properties to React style', () => {
      const token = createThemedToken({
        content: 'test',
        htmlStyle: {
          'font-style': 'italic',
          'font-weight': 'bold',
          'background-color': '#f5f5f5',
          'text-decoration': 'underline',
          color: '#ff0000',
          'font-family': 'monospace',
          'border-radius': '2px'
        }
      })
      const result = getReactStyleFromToken(token)

      expect(result).toEqual({
        fontStyle: 'italic',
        fontWeight: 'bold',
        backgroundColor: '#f5f5f5',
        textDecoration: 'underline',
        color: '#ff0000',
        'font-family': 'monospace',
        'border-radius': '2px'
      })
    })

    it('should keep other CSS property names unchanged', () => {
      const token = createThemedToken({
        content: 'const',
        offset: 0,
        htmlStyle: {
          color: '#FF0000',
          opacity: '0.8',
          border: '1px solid black'
        }
      })

      const result = getReactStyleFromToken(token)

      expect(result).toEqual({
        color: '#FF0000',
        opacity: '0.8',
        border: '1px solid black'
      })
    })

    it('should handle complex style combinations', () => {
      const token = createThemedToken({
        content: 'const',
        offset: 0,
        htmlStyle: {
          color: '#FF0000',
          'font-style': 'italic',
          'font-weight': 'bold',
          'background-color': '#EEEEEE',
          'text-decoration': 'underline',
          opacity: '0.8',
          border: '1px solid black'
        }
      })

      const result = getReactStyleFromToken(token)

      expect(result).toEqual({
        color: '#FF0000',
        fontStyle: 'italic',
        fontWeight: 'bold',
        backgroundColor: '#EEEEEE',
        textDecoration: 'underline',
        opacity: '0.8',
        border: '1px solid black'
      })
    })

    it('should handle multiple fontStyle values', () => {
      const token = createThemedToken({
        content: 'const',
        offset: 0,
        color: '#0000FF',
        fontStyle: FS_BOLD | FS_UNDERLINE
      })

      const result = getReactStyleFromToken(token)

      expect(result).toEqual({
        color: '#0000FF',
        fontWeight: 'bold',
        textDecoration: 'underline'
      })
    })

    it('should handle tokens with no style', () => {
      const token = createThemedToken({
        content: 'const',
        offset: 0
      })

      const result = getReactStyleFromToken(token)

      expect(result).toEqual({})
    })
  })
})
