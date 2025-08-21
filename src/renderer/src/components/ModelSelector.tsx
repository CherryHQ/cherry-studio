import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ModelLabels from '@renderer/components/ModelLabels'

import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { matchKeywordsInString } from '@renderer/utils'
import { getFancyProviderName } from '@renderer/utils/naming'
import { Avatar, Select, SelectProps } from 'antd'
import { BaseSelectRef } from 'rc-select'
import { sortBy } from 'lodash'
import React, { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { isEmbeddingModel } from '@renderer/config/models'

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

/**
 * 模型选择器，封装了 antd Select
 * - 通过传入模型服务商列表和模型 predicate 来构造选项
 * - 支持按服务商分组
 * - 可以控制 avatar 和 suffix 显示与否
 * @param providers 服务商列表
 * @param predicate 模型过滤条件
 * @param grouped 是否按服务商分组
 * @param showAvatar 是否显示模型图标
 * @param showSuffix 是否在模型名称后显示服务商作为后缀
 */
const ModelSelector = ({
  providers,
  predicate,
  grouped = true,
  showAvatar = true,
  showSuffix = true,
  ref,
  ...props
}: ModelSelectorProps & { ref?: React.Ref<BaseSelectRef> | null }) => {
  const { t } = useTranslation()

  // 单个 provider 的模型选项
  const getModelOptions = useCallback(
    (p: Provider, fancyName: string) => {
      // 智谱模型不显示provider名称后缀
      const suffix = showSuffix && p.id !== 'zhipu' ? <span style={{ opacity: 0.45 }}>{` | ${fancyName}`}</span> : null

      let filteredModels = sortBy(p.models, 'name').filter((model) => predicate?.(model) ?? true)

      // 智谱模型特殊处理
      if (p.id === 'zhipu') {
        const hasApiKey = p.apiKey && p.apiKey.trim() !== ''

        // 如果未配置API Key，只显示四个指定模型和嵌入模型
        if (!hasApiKey) {
          filteredModels = filteredModels.filter(
            (m) => m.id === 'glm-4.5-flash' || m.id === 'glm-4.5' || m.id === 'glm-4.5-air' || m.id === 'glm-4.5v' || isEmbeddingModel(m)
          )
        }

        // 智谱模型排序：按照新的顺序排序
        filteredModels = sortBy(filteredModels, (model) => {
          // 定义GLM-4.5系列的排序优先级
          const sortOrder = {
            'glm-4.5-flash': '0',
            'glm-4.5': '1',
            'glm-4.5-air': '2',
            'glm-4.5v': '3',
            'glm-4.5-airx': '4',
          }
          return sortOrder[model.id] || model.name // 其他模型按名称排序
        })
      }

      return filteredModels.map((m) => ({
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showAvatar && <ModelAvatar model={m} size={18} />}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {m.name}
              <ModelLabels model={m} parentContainer="ModelSelector" />
              {suffix}
            </span>
          </div>
        ),
        title: p.id === 'zhipu' ? m.name : `${m.name} | ${fancyName}`,
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

  const labelRender = useCallback(
    (props) => {
      const { label } = props
      if (label) {
        return label
      } else {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showAvatar && <Avatar size={18} />}
            <span>{t('knowledge.error.model_invalid')}</span>
          </div>
        )
      }
    },
    [showAvatar, t]
  )

  return (
    <Select
      ref={ref}
      options={options}
      filterOption={modelSelectFilter}
      labelRender={labelRender}
      showSearch
      {...props}
    />
  )
}

export default memo(ModelSelector)

/**
 * 用于 antd Select 组件的 filterOption，统一搜索行为：
 * - 优先使用 title 匹配
 * - 其次使用 label 匹配
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
