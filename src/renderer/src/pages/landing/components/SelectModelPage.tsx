import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useLanding } from '@renderer/context/LandingContext'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import { Button } from 'antd'
import { find } from 'lodash'
import { ArrowLeft, Languages, MessageSquareMore, Rocket } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'

const SelectModelPage: FC = () => {
  const { completeLanding, setStep } = useLanding()
  const { defaultModel, quickModel, translateModel, setDefaultModel, setQuickModel, setTranslateModel } =
    useDefaultModel()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultModelValue = useMemo(
    () => (hasModel(defaultModel) ? getModelUniqId(defaultModel) : undefined),
    [defaultModel]
  )

  const quickModelValue = useMemo(() => (hasModel(quickModel) ? getModelUniqId(quickModel) : undefined), [quickModel])

  const translateModelValue = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  const handleComplete = () => {
    completeLanding()
  }

  const handleBack = () => {
    setStep('welcome')
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      <Button
        type="text"
        icon={<ArrowLeft size={18} />}
        className="text-(--color-text-3) opacity-50 hover:opacity-80"
        style={{ position: 'absolute', top: 16, left: 16 }}
        onClick={handleBack}
      />
      <div className="flex w-96 flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">选择你的默认模型</h1>
          <p className="m-0 text-(--color-text-2) text-sm">为每个场景选择默认模型</p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <MessageSquareMore size={18} className="text-(--color-text-2)" />
              <span className="font-medium text-(--color-text) text-sm">默认助手</span>
            </div>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={defaultModelValue}
              style={{ width: '100%', height: 42 }}
              onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
              placeholder="选择模型"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Rocket size={18} className="text-(--color-text-2)" />
              <span className="font-medium text-(--color-text) text-sm">快速模型</span>
            </div>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={quickModelValue}
              style={{ width: '100%', height: 42 }}
              onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
              placeholder="选择模型"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Languages size={18} className="text-(--color-text-2)" />
              <span className="font-medium text-(--color-text) text-sm">翻译模型</span>
            </div>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={translateModelValue}
              style={{ width: '100%', height: 42 }}
              onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
              placeholder="选择模型"
            />
          </div>
        </div>

        <Button type="primary" size="large" block className="h-12 rounded-lg" onClick={handleComplete}>
          开始使用
        </Button>

        <p className="m-0 text-center text-(--color-text-3) text-xs">您可以随时在设置中更改</p>
      </div>
    </div>
  )
}

export default SelectModelPage
