import i18n from '@renderer/i18n'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { sortBy } from 'lodash'
import React from 'react'

import { getFancyProviderName } from './naming'

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

function getProviderSearchString(provider: Provider) {
  return provider.isSystem ? `${i18n.t(`provider.${provider.id}`)} ${provider.id}` : provider.name
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

/**
 * 用于 antd Select 组件的 filterOption，统一搜索行为：
 * - 优先使用 label 匹配
 * - 其次使用 title 匹配
 * - 最后使用 value 匹配
 *
 * @param input 用户输入的搜索字符串
 * @param option Select 选项对象，包含 label 或 value
 * @returns 是否匹配
 */
export function modelSelectFilter(input: string, option: any) {
  const target =
    typeof option?.title === 'string'
      ? option.title
      : typeof option?.label === 'string'
        ? option.label
        : typeof option?.value === 'string'
          ? option.value
          : ''
  return matchKeywordsInString(input, target)
}

/**
 * 用于 antd Select 组件的 options，按服务商分组，并且可以提供过滤条件
 * @param providers 服务商列表
 * @param predicate 过滤条件
 * @returns 选项列表
 */
export function getModelSelectOptions(providers: Provider[], predicate?: (model: Model) => boolean) {
  return providers.flatMap((p) => {
    const fancyName = getFancyProviderName(p)
    const options = sortBy(p.models, 'name')
      .filter((model) => predicate?.(model) ?? true)
      .map((m) => ({
        label: React.createElement(
          React.Fragment,
          {},
          m.name,
          React.createElement('span', { style: { opacity: 0.45 } }, ` | ${fancyName}`)
        ),
        title: `${m.name} | ${fancyName}`,
        value: getModelUniqId(m)
      }))

    return options.length > 0
      ? [
          {
            label: fancyName,
            title: p.name,
            options
          }
        ]
      : []
  })
}
