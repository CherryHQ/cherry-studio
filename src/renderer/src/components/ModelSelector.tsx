import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { matchKeywordsInString } from '@renderer/utils'
import { getFancyProviderName } from '@renderer/utils/naming'
import { Select, SelectProps } from 'antd'
import { sortBy } from 'lodash'
import { BaseSelectRef } from 'rc-select'
import { memo, useCallback, useMemo } from 'react'

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

interface ModelSelectorProps extends SelectProps {
  providers?: Provider[]
  predicate?: (model: Model) => boolean
  grouped?: boolean
  showAvatar?: boolean
  showSuffix?: boolean
}

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
    (p: Provider, fancyName: string) => {
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

    if (grouped) {
      return providers.flatMap((p) => {
        const fancyName = getFancyProviderName(p)
        const modelOptions = getModelOptions(p, fancyName)
        return modelOptions.length > 0
          ? [
              {
                label: fancyName,
                title: p.name,
                options: modelOptions
              } as GroupedModelOption
            ]
          : []
      })
    }
    return providers.flatMap((p) => getModelOptions(p, getFancyProviderName(p)))
  }, [providers, grouped, getModelOptions])

  return <Select ref={ref} options={options} filterOption={modelSelectFilter} showSearch {...props} />
}

export default memo(ModelSelector)

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
