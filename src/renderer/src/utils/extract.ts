import { XMLParser } from 'fast-xml-parser'
export interface ExtractResults {
  websearch?: WebsearchExtractResults
  knowledge?: KnowledgeExtractResults
}

export interface WebsearchExtractResults {
  question: string[]
  link?: string[]
}

export interface KnowledgeExtractResults {
  rewrite: string
  question: string[]
}
/**
 * 从带有XML标签的文本中提取信息
 * @public
 * @param text 包含XML标签的文本
 * @returns 提取的信息对象
 * @throws 如果文本中没有question标签则抛出错误
 */
export const extractInfoFromXML = (text: string): ExtractResults => {
  console.log('Extracting information from XML:', text)
  const parser = new XMLParser({
    isArray: (name) => {
      return name === 'question' || name === 'link'
    }
  })
  const extractResults: ExtractResults = parser.parse(text)
  console.log('Extracted results:', extractResults)
  return extractResults
}
