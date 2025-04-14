export interface ExtractResults {
  question: string
  links?: string[]
  tools?: string[]
}
/**
 * 从带有XML标签的文本中提取信息
 * @public
 * @param text 包含XML标签的文本
 * @returns 提取的信息对象
 * @throws 如果文本中没有question标签则抛出错误
 */
export const extractInfoFromXML = (text: string): ExtractResults => {
  // 提取question标签内容
  const questionMatch = text.match(/<question>([\s\S]*?)<\/question>/)
  if (!questionMatch) {
    throw new Error('Missing required <question> tag')
  }
  const question = questionMatch[1].trim()

  // 提取links标签内容（可选）
  const linksMatch = text.match(/<links>([\s\S]*?)<\/links>/)
  const links = linksMatch
    ? linksMatch[1]
        .trim()
        .split('\n')
        .map((link) => link.trim())
        .filter((link) => link !== '')
    : undefined

  const toolsMatch = text.match(/<tools>([\s\S]*?)<\/tools>/)
  const tools = toolsMatch
    ? toolsMatch[1]
        .trim()
        .split(',')
        .map((tool) => tool.trim())
        .filter((tool) => tool !== '' && tool !== 'none')
    : undefined

  return {
    question,
    links,
    tools
  }
}
