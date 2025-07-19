import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
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
