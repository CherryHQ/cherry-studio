import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { matchKeywordsInString } from '@renderer/utils'
import { getFancyProviderName } from '@renderer/utils/naming'
import { Select, SelectProps } from 'antd'
import { sortBy } from 'lodash'
import { BaseSelectRef } from 'rc-select'
import { memo, useCallback, useMemo } from 'react'

interface ModelSelectorProps extends SelectProps {
  providers?: Provider[]
  predicate?: (model: Model) => boolean
  grouped?: boolean
  showAvatar?: boolean
  showSuffix?: boolean
}

interface ModelOption {
  label: React.ReactNode
  title: string
  value: string
}

interface GroupedModelOption {
  label: string
  title: string
  options: ModelOption[]
}

type SelectOption = ModelOption | GroupedModelOption

const ModelSelector = ({
  providers,
  predicate,
  grouped = true,
  showAvatar = true,
  showSuffix = true,
  ref,
  ...props
}: ModelSelectorProps & { ref?: React.Ref<BaseSelectRef> | null }) => {
  // 单个 provider 的模型选项
  const getModelOptions = useCallback(
    (p: Provider) => {
      const fancyName = getFancyProviderName(p)
      const suffix = showSuffix ? <span style={{ opacity: 0.45 }}>{` | ${fancyName}`}</span> : null
      return sortBy(p.models, 'name')
        .filter((model) => predicate?.(model) ?? true)
        .map((m) => ({
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {showAvatar && <ModelAvatar model={m} size={18} />}
              <span>
                {m.name}
                {suffix}
              </span>
            </div>
          ),
          title: `${m.name} | ${fancyName}`,
          value: getModelUniqId(m)
        }))
    },
    [predicate, showAvatar, showSuffix]
  )

  // 所有 provider 的模型选项
  const options = useMemo((): SelectOption[] => {
    if (!providers) return []

    return grouped
      ? providers.flatMap((p) => {
          const modelOptions = getModelOptions(p)
          return modelOptions.length > 0
            ? [
                {
                  label: getFancyProviderName(p),
                  title: p.name,
                  options: modelOptions
                } as GroupedModelOption
              ]
            : []
        })
      : providers.flatMap(getModelOptions)
  }, [providers, grouped, getModelOptions])

  return <Select ref={ref} options={options} filterOption={modelSelectFilter} showSearch {...props} />
}

export default memo(ModelSelector)

/**
 * 用于 antd Select 组件的 options
 * - 按服务商分组
 * - 按模型名称排序
 * - 可以提供过滤条件
 * @param providers 服务商列表
 * @param predicate 过滤条件
 * @param showSuffix 是否显示后缀（组名）
 * @returns 选项列表
 */
export function modelSelectOptions(
  providers: Provider[],
  predicate?: (model: Model) => boolean,
  showAvatar: boolean = true,
  showSuffix: boolean = true
) {
  return providers.flatMap((p) => {
    const fancyName = getFancyProviderName(p)
    const suffix = showSuffix ? <span style={{ opacity: 0.45 }}>{` | ${fancyName}`}</span> : null
    const options = sortBy(p.models, 'name')
      .filter((model) => predicate?.(model) ?? true)
      .map((m) => ({
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showAvatar && <ModelAvatar model={m} size={18} />}
            <span>
              {m.name}
              {suffix}
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
 * 用于 antd Select 组件的 options
 * - 没有分组
 * - 按模型名称排序
 * - 可以提供过滤条件
 * @param providers 服务商列表
 * @param predicate 过滤条件
 * @param showSuffix 是否显示后缀（组名）
 * @returns 选项列表
 */
export function modelSelectOptionsFlat(
  providers: Provider[],
  predicate?: (model: Model) => boolean,
  showAvatar: boolean = true,
  showSuffix: boolean = true
) {
  return providers.flatMap((p) => {
    const fancyName = getFancyProviderName(p)
    const suffix = showSuffix ? <span style={{ opacity: 0.45 }}>{` | ${fancyName}`}</span> : null

    return sortBy(p.models, 'name')
      .filter((model) => predicate?.(model) ?? true)
      .map((m) => ({
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showAvatar && <ModelAvatar model={m} size={18} />}
            <span>
              {m.name}
              {suffix}
            </span>
          </div>
        ),
        title: m.name,
        value: getModelUniqId(m)
      }))
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
