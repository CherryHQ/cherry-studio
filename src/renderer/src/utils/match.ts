import { getProviderLabel } from '@renderer/i18n/label'
import { isSystemProvider, Model, Provider } from '@renderer/types'

/**
 * 判断一个字符串是否包含由另一个字符串表示的 keywords
 * 将 keywords 按空白字符分割成多个关键词，检查目标字符串是否包含所有关键词
 * - 大小写不敏感
 * - 支持的分隔符：空格、制表符、换行符等各种空白字符
 *
 * @param target 被搜索的字符串
 * @param keywords 关键词字符串（空格分隔）或关键词数组
 * @returns 包含所有关键词或者没有有效关键词则返回 true
 */
export function includeKeywords(target: string, keywords: string | string[]): boolean {
  const keywordArray = Array.isArray(keywords) ? keywords : (keywords || '').split(/\s+/)
  const nonEmptyKeywords = keywordArray.filter(Boolean)

  // 如果没有有效关键词，则视为匹配
  if (nonEmptyKeywords.length === 0) return true

  // 如果没有搜索目标，则视为不匹配
  if (!target || typeof target !== 'string') return false
  const targetLower = target.toLowerCase()

  return nonEmptyKeywords.every((keyword) => targetLower.includes(keyword.toLowerCase()))
}

/**
 * 检查字符串是否包含所有关键词
 * @see includeKeywords
 * @param keywords 关键词字符串（空格分隔）或关键词数组
 * @param value 被搜索的目标字符串
 * @returns 包含所有关键词则返回 true
 */
export function matchKeywordsInString(keywords: string | string[], value: string): boolean {
  return includeKeywords(value, keywords)
}

/**
 * 检查 Provider 是否匹配所有关键词
 * @param keywords 关键词字符串（空格分隔）或关键词数组
 * @param provider 被搜索的 Provider 对象
 * @returns 匹配所有关键词则返回 true
 */
export function matchKeywordsInProvider(keywords: string | string[], provider: Provider): boolean {
  return includeKeywords(getProviderSearchString(provider), keywords)
}

/**
 * 检查 Model 是否匹配所有关键词
 * @param keywords 关键词字符串（空格分隔）或关键词数组
 * @param model 被搜索的 Model 对象
 * @param provider 可选的 Provider 对象，用于生成完整模型名称
 * @returns 匹配所有关键词则返回 true
 */
export function matchKeywordsInModel(keywords: string | string[], model: Model, provider?: Provider): boolean {
  const fullName = `${model.name} ${model.id} ${provider ? getProviderSearchString(provider) : ''}`
  return includeKeywords(fullName, keywords)
}

/**
 * 获取 Provider 的搜索字符串，它和 getFancyProviderName 不同
 * @param provider Provider 对象
 * @returns 搜索字符串
 */
function getProviderSearchString(provider: Provider) {
  return isSystemProvider(provider) ? `${getProviderLabel(provider.id)} ${provider.id}` : provider.name
}

/**
 * 根据关键词过滤模型
 * @param keywords 关键词字符串
 * @param models 模型数组
 * @param provider 可选的 Provider 对象，用于生成完整模型名称
 * @returns 过滤后的模型数组
 */
export function filterModelsByKeywords(keywords: string, models: Model[], provider?: Provider): Model[] {
  const keywordsArray = keywords.toLowerCase().split(/\s+/).filter(Boolean)
  return models.filter((model) => matchKeywordsInModel(keywordsArray, model, provider))
}
