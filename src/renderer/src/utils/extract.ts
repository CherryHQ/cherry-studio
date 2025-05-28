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
    }
  })
  // Logger.log('Extracted results:', extractResults)
  return parser.parse(text)
}
