import { XMLParser } from 'fast-xml-parser'

export interface ExtractResults {
  websearch?: WebsearchExtractResults
  knowledge?: KnowledgeExtractResults
}

export interface WebsearchExtractResults {
  question: string[]
  links?: string[]
}

export interface KnowledgeExtractResults {
  rewrite: string
  question: string[]
}
/**
 * 从带有XML标签的文本中提取信息
 * @public
 * @param {string} text 包含XML标签的文本
 * @returns {ExtractResults} 提取的信息对象
 * @throws
 */
export const extractInfoFromXML = (text: string): ExtractResults => {
  // Logger.log('extract text', text)
  const parser = new XMLParser({
    isArray: (name) => {
      return name === 'question' || name === 'links'
    },
    // Keep tag values as strings. Without this, a purely numeric query like
    // "2028" is coerced to a number, and downstream `question.trim()` throws
    // "TypeError: question.trim is not a function". `question`/`links`/`rewrite`
    // are declared `string`, so this also keeps the parsed shape honest.
    parseTagValue: false
  })
  // Logger.log('Extracted results:', extractResults)
  return parser.parse(text)
}
