import { describe, expect, it } from 'vitest'

import { extractInfoFromXML } from '../extract'

describe('extract', () => {
  describe('extractInfoFromXML', () => {
    it('should parse websearch XML with questions and links', () => {
      const xml = `
        <websearch>
          <question>What is the capital of France?</question>
          <question>How many people live in Paris?</question>
          <links>https://en.wikipedia.org/wiki/Paris</links>
          <links>https://www.paris.fr/</links>
        </websearch>
      `

      const result = extractInfoFromXML(xml)

      expect(result).toEqual({
        websearch: {
          question: ['What is the capital of France?', 'How many people live in Paris?'],
          links: ['https://en.wikipedia.org/wiki/Paris', 'https://www.paris.fr/']
        }
      })
    })

    it('should parse knowledge XML with rewrite and questions', () => {
      const xml = `
        <knowledge>
          <rewrite>This is a rewritten query</rewrite>
          <question>What is artificial intelligence?</question>
          <question>Who invented machine learning?</question>
        </knowledge>
      `

      const result = extractInfoFromXML(xml)

      expect(result).toEqual({
        knowledge: {
          rewrite: 'This is a rewritten query',
          question: ['What is artificial intelligence?', 'Who invented machine learning?']
        }
      })
    })

    it('should parse XML with both websearch and knowledge wrapped in root tag', () => {
      const xml = `
        <root>
          <websearch>
            <question>What is climate change?</question>
            <links>https://en.wikipedia.org/wiki/Climate_change</links>
          </websearch>
          <knowledge>
            <rewrite>climate change effects</rewrite>
            <question>What are the effects of climate change?</question>
          </knowledge>
        </root>
      `

      const result = extractInfoFromXML(xml)

      // 注意：当使用 root 标签包裹时，结果包含 root 属性
      expect(result).toEqual({
        root: {
          websearch: {
            question: ['What is climate change?'],
            links: ['https://en.wikipedia.org/wiki/Climate_change']
          },
          knowledge: {
            rewrite: 'climate change effects',
            question: ['What are the effects of climate change?']
          }
        }
      })
    })

    it('should handle XML with single question and no links', () => {
      const xml = `
        <websearch>
          <question>Single question?</question>
        </websearch>
      `

      const result = extractInfoFromXML(xml)

      expect(result).toEqual({
        websearch: {
          question: ['Single question?']
        }
      })
    })

    it('should handle XML with special characters', () => {
      const xml = `
        <websearch>
          <question>What is the meaning of &lt;div&gt; in HTML?</question>
          <links>https://developer.mozilla.org/en-US/docs/Web/HTML/Element/div</links>
        </websearch>
      `

      const result = extractInfoFromXML(xml)

      expect(result).toEqual({
        websearch: {
          question: ['What is the meaning of <div> in HTML?'],
          links: ['https://developer.mozilla.org/en-US/docs/Web/HTML/Element/div']
        }
      })
    })

    it('should handle invalid XML gracefully', () => {
      const invalidXml = `
        <websearch>
          <question>Incomplete tag
          <links>https://example.com</links>
        </websearch>
      `

      // 注意：XMLParser 能够处理一些无效的 XML
      const result = extractInfoFromXML(invalidXml)
      expect(result).toBeDefined()
    })

    it('should handle empty XML input', () => {
      // 注意：XMLParser 会尝试解析空字符串
      const result = extractInfoFromXML('')
      expect(result).toEqual({})
    })

    it('should handle XML with empty tags', () => {
      const xml = `
        <websearch>
          <question></question>
          <links></links>
        </websearch>
      `

      const result = extractInfoFromXML(xml)

      expect(result).toEqual({
        websearch: {
          question: [''],
          links: ['']
        }
      })
    })
  })
})
