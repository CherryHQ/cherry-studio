import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { matchKeywordsInString } from '@renderer/utils'
import { getFancyProviderName } from '@renderer/utils/naming'
import { sortBy } from 'lodash'

/**
 * 用于 antd Select 组件的 options，按服务商分组，并且可以提供过滤条件
 * @param providers 服务商列表
 * @param predicate 过滤条件
 * @returns 选项列表
 */
export function modelSelectOptions(providers: Provider[], predicate?: (model: Model) => boolean) {
  return providers.flatMap((p) => {
    const fancyName = getFancyProviderName(p)
    const options = sortBy(p.models, 'name')
      .filter((model) => predicate?.(model) ?? true)
      .map((m) => ({
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ModelAvatar model={m} size={18} />
            <span>
              {m.name}
              <span style={{ opacity: 0.45 }}>{` | ${fancyName}`}</span>
            </span>
          </div>
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
export function modelSelectFilter(input: string, option: any): boolean {
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
