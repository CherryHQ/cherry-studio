import { Button, Flex, Switch, Tooltip, WarnTooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import {
  EmbeddingTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/Model'
import { endpointTypeOptions } from '@renderer/config/endpointTypes'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models/v2'
import { useDynamicLabelWidth } from '@renderer/hooks/useDynamicLabelWidth'
import { getDefaultGroupName } from '@renderer/utils'
import { isNewApiProvider } from '@renderer/utils/provider.v2'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ModalProps } from 'antd'
import { Divider, Form, Input, InputNumber, Modal, Select } from 'antd'
import { ChevronDown, ChevronUp, RotateCcw, SaveIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type ToggleType = 'vision' | 'reasoning' | 'function_calling' | 'web_search' | 'embedding' | 'rerank'

const TOGGLE_TO_V2: Record<ToggleType, string> = {
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  rerank: MODEL_CAPABILITY.RERANK
}

const V2_TO_TOGGLE: Record<string, ToggleType> = Object.fromEntries(
  Object.entries(TOGGLE_TO_V2).map(([k, v]) => [v, k as ToggleType])
) as Record<string, ToggleType>

function capsToToggleSet(caps: string[]): Set<ToggleType> {
  const s = new Set<ToggleType>()
  for (const c of caps) {
    const t = V2_TO_TOGGLE[c]
    if (t) s.add(t)
  }
  return s
}

function toggleSetToCaps(original: string[], selected: Set<ToggleType>): string[] {
  const toggleCaps = new Set(Object.values(TOGGLE_TO_V2))
  const kept = original.filter((c) => !toggleCaps.has(c))
  for (const t of selected) {
    kept.push(TOGGLE_TO_V2[t])
  }
  return kept
}

interface ModelEditContentProps {
  provider: Provider
  model: Model
  onUpdateModel: (patch: Partial<Model>) => void
}

const symbols = ['$', '¥', '€', '£']

function readCurrency(model: Model): string {
  return model.pricing?.input?.currency ?? model.pricing?.output?.currency ?? '$'
}

const ModelEditContent: FC<ModelEditContentProps & ModalProps> = ({ provider, model, onUpdateModel, ...props }) => {
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [currencySymbol, setCurrencySymbol] = useState(readCurrency(model))
  const [isCustomCurrency, setIsCustomCurrency] = useState(!symbols.includes(readCurrency(model)))
  const [supportsStreaming, setSupportsStreaming] = useState(model.supportsStreaming)
  const [hasUserModified, setHasUserModified] = useState(false)

  const labelWidth = useDynamicLabelWidth([t('settings.models.add.endpoint_type.label')])

  const buildPatch = (overrides?: {
    caps?: Set<ToggleType>
    streaming?: boolean
    currency?: string
    isCustom?: boolean
  }): Partial<Model> => {
    const formValues = form.getFieldsValue()
    const currentIsCustom = overrides?.isCustom ?? isCustomCurrency
    const currentCurrency = overrides?.currency ?? currencySymbol
    const finalCurrency = currentIsCustom
      ? formValues.customCurrencySymbol || currentCurrency
      : formValues.currencySymbol || currentCurrency || '$'

    const caps = overrides?.caps ?? selectedCaps

    return {
      name: formValues.name || model.name,
      group: formValues.group || model.group,
      endpointTypes: isNewApiProvider(provider) && formValues.endpointType ? [formValues.endpointType] : undefined,
      capabilities: toggleSetToCaps(model.capabilities ?? [], caps) as Model['capabilities'],
      supportsStreaming: overrides?.streaming ?? supportsStreaming,
      pricing: {
        input: { perMillionTokens: Number(formValues.input_per_million_tokens) || 0, currency: finalCurrency },
        output: { perMillionTokens: Number(formValues.output_per_million_tokens) || 0, currency: finalCurrency }
      }
    }
  }

  const autoSave = (overrides?: {
    caps?: Set<ToggleType>
    streaming?: boolean
    currency?: string
    isCustom?: boolean
  }) => {
    onUpdateModel(buildPatch(overrides))
  }

  const onFinish = () => {
    onUpdateModel(buildPatch())
    setShowMoreSettings(false)
    props.onOk?.(undefined as any)
  }

  const currencyOptions = [
    ...symbols.map((symbol) => ({ label: symbol, value: symbol })),
    { label: t('models.price.custom'), value: 'custom' }
  ]

  const savedCaps = useMemo(() => capsToToggleSet(model.capabilities ?? []), [model.capabilities])

  const defaultTypes = useMemo(
    (): Set<ToggleType> =>
      new Set<ToggleType>([
        ...(isVisionModel(model) ? (['vision'] as const) : []),
        ...(isReasoningModel(model) ? (['reasoning'] as const) : []),
        ...(isFunctionCallingModel(model) ? (['function_calling'] as const) : []),
        ...(isWebSearchModel(model) ? (['web_search'] as const) : []),
        ...(isEmbeddingModel(model) ? (['embedding'] as const) : []),
        ...(isRerankModel(model) ? (['rerank'] as const) : [])
      ]),
    [model]
  )

  const [selectedCaps, setSelectedCaps] = useState<Set<ToggleType>>(() => new Set([...savedCaps, ...defaultTypes]))

  useEffect(() => {
    if (hasUserModified && showMoreSettings) {
      autoSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaps])

  const CapabilityToggles = () => {
    const isRerankDisabled = selectedCaps.has('embedding')
    const isEmbeddingDisabled = selectedCaps.has('rerank')
    const isOtherDisabled = selectedCaps.has('rerank') || selectedCaps.has('embedding')

    const handleReset = () => {
      setSelectedCaps(new Set([...savedCaps, ...defaultTypes]))
      setHasUserModified(false)
    }

    const toggle = useCallback((type: ToggleType) => {
      setHasUserModified(true)
      setSelectedCaps((prev) => {
        const next = new Set(prev)
        if (next.has(type)) {
          next.delete(type)
        } else {
          next.add(type)
        }
        return next
      })
    }, [])

    return (
      <>
        <TypeTitle>
          <Flex className="h-6 items-center gap-1">
            {t('models.type.select')}
            <WarnTooltip content={t('settings.moresetting.check.warn')} />
          </Flex>
          {hasUserModified && (
            <Tooltip content={t('common.reset')}>
              <Button size="icon-sm" onClick={handleReset} variant="ghost">
                <RotateCcw size={14} />
              </Button>
            </Tooltip>
          )}
        </TypeTitle>
        <Flex className="mb-2 flex-wrap items-center justify-start gap-1">
          <VisionTag
            showLabel
            inactive={isOtherDisabled || !selectedCaps.has('vision')}
            disabled={isOtherDisabled}
            onClick={() => toggle('vision')}
          />
          <WebSearchTag
            showLabel
            inactive={isOtherDisabled || !selectedCaps.has('web_search')}
            disabled={isOtherDisabled}
            onClick={() => toggle('web_search')}
          />
          <ReasoningTag
            showLabel
            inactive={isOtherDisabled || !selectedCaps.has('reasoning')}
            disabled={isOtherDisabled}
            onClick={() => toggle('reasoning')}
          />
          <ToolsCallingTag
            showLabel
            inactive={isOtherDisabled || !selectedCaps.has('function_calling')}
            disabled={isOtherDisabled}
            onClick={() => toggle('function_calling')}
          />
          <RerankerTag
            disabled={isRerankDisabled}
            inactive={isRerankDisabled || !selectedCaps.has('rerank')}
            onClick={() => toggle('rerank')}
          />
          <EmbeddingTag
            inactive={isEmbeddingDisabled || !selectedCaps.has('embedding')}
            disabled={isEmbeddingDisabled}
            onClick={() => toggle('embedding')}
          />
        </Flex>
      </>
    )
  }

  const inputPrice = model.pricing?.input?.perMillionTokens ?? 0
  const outputPrice = model.pricing?.output?.perMillionTokens ?? 0

  return (
    <Modal title={t('models.edit')} footer={null} transitionName="animation-move-down" centered {...props}>
      <Form
        form={form}
        labelCol={{ flex: isNewApiProvider(provider) ? labelWidth : '110px' }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 15 }}
        initialValues={{
          id: model.id,
          name: model.name,
          group: model.group,
          endpointType: model.endpointTypes?.[0],
          input_per_million_tokens: inputPrice,
          output_per_million_tokens: outputPrice,
          currencySymbol: symbols.includes(currencySymbol) ? currencySymbol : 'custom',
          customCurrencySymbol: symbols.includes(currencySymbol) ? '' : currencySymbol
        }}
        onFinish={onFinish}>
        <Form.Item
          name="id"
          label={t('settings.models.add.model_id.label')}
          tooltip={t('settings.models.add.model_id.tooltip')}
          rules={[{ required: true }]}>
          <Flex className="justify-between gap-[5px]">
            <Input
              placeholder={t('settings.models.add.model_id.placeholder')}
              spellCheck={false}
              maxLength={200}
              disabled={true}
              value={model.id}
              onChange={(e) => {
                const value = e.target.value
                form.setFieldValue('name', value)
                form.setFieldValue('group', getDefaultGroupName(value))
              }}
              suffix={
                <CopyIcon
                  size={14}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const val = form.getFieldValue('name')
                    void navigator.clipboard.writeText((val.id || model.id) as string)
                    window.toast.success(t('message.copied'))
                  }}
                />
              }
            />
          </Flex>
        </Form.Item>
        <Form.Item
          name="name"
          label={t('settings.models.add.model_name.label')}
          tooltip={t('settings.models.add.model_name.tooltip')}>
          <Input placeholder={t('settings.models.add.model_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="group"
          label={t('settings.models.add.group_name.label')}
          tooltip={t('settings.models.add.group_name.tooltip')}>
          <Input placeholder={t('settings.models.add.group_name.placeholder')} spellCheck={false} />
        </Form.Item>
        {isNewApiProvider(provider) && (
          <Form.Item
            name="endpointType"
            label={t('settings.models.add.endpoint_type.label')}
            tooltip={t('settings.models.add.endpoint_type.tooltip')}
            rules={[{ required: true, message: t('settings.models.add.endpoint_type.required') }]}>
            <Select placeholder={t('settings.models.add.endpoint_type.placeholder')}>
              {endpointTypeOptions.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 8, textAlign: 'center' }}>
          <Flex className="relative items-center justify-between">
            <Button
              type="button"
              variant="default"
              onClick={() => setShowMoreSettings(!showMoreSettings)}
              style={{ color: 'var(--color-text-3)' }}>
              {t('settings.moresetting.label')}
              {showMoreSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>
            <Button type="submit">
              <SaveIcon size={16} />
              {t('common.save')}
            </Button>
          </Flex>
        </Form.Item>
        {showMoreSettings && (
          <div style={{ marginBottom: 8 }}>
            <Divider style={{ margin: '16px 0 16px 0' }} />
            <CapabilityToggles />
            <Divider style={{ margin: '16px 0 12px 0' }} />
            <Form.Item
              name="supportsStreaming"
              style={{ marginBottom: 10 }}
              labelCol={{ flex: 1 }}
              label={t('settings.models.add.supported_text_delta.label')}
              tooltip={t('settings.models.add.supported_text_delta.tooltip')}>
              <Switch
                checked={supportsStreaming}
                className="ml-auto"
                onCheckedChange={(checked) => {
                  setSupportsStreaming(checked)
                  autoSave({ streaming: checked })
                }}
              />
            </Form.Item>
            <Divider style={{ margin: '12px 0 16px 0' }} />
            <Form.Item name="currencySymbol" label={t('models.price.currency')} style={{ marginBottom: 10 }}>
              <Select
                style={{ width: '100px' }}
                options={currencyOptions}
                onChange={(value) => {
                  if (value === 'custom') {
                    const customSymbol = form.getFieldValue('customCurrencySymbol') || ''
                    setIsCustomCurrency(true)
                    setCurrencySymbol(customSymbol)
                    autoSave({ isCustom: true, currency: customSymbol })
                  } else {
                    setIsCustomCurrency(false)
                    setCurrencySymbol(value)
                    autoSave({ isCustom: false, currency: value })
                  }
                }}
                dropdownMatchSelectWidth={false}
              />
            </Form.Item>

            {isCustomCurrency && (
              <Form.Item
                name="customCurrencySymbol"
                label={t('models.price.custom_currency')}
                style={{ marginBottom: 10 }}
                rules={[{ required: isCustomCurrency }]}>
                <Input
                  style={{ width: '100px' }}
                  placeholder={t('models.price.custom_currency_placeholder')}
                  defaultValue={currencySymbol}
                  maxLength={5}
                  onChange={(e) => {
                    const newValue = e.target.value
                    setCurrencySymbol(newValue)
                    autoSave({ currency: newValue, isCustom: true })
                  }}
                />
              </Form.Item>
            )}

            <Form.Item label={t('models.price.input')} style={{ marginBottom: 10 }} name="input_per_million_tokens">
              <InputNumber
                placeholder="0.00"
                defaultValue={inputPrice}
                min={0}
                step={0.01}
                precision={2}
                style={{ width: '240px' }}
                addonAfter={`${currencySymbol} / ${t('models.price.million_tokens')}`}
                onChange={() => autoSave()}
              />
            </Form.Item>
            <Form.Item label={t('models.price.output')} style={{ marginBottom: 10 }} name="output_per_million_tokens">
              <InputNumber
                placeholder="0.00"
                defaultValue={outputPrice}
                min={0}
                step={0.01}
                precision={2}
                style={{ width: '240px' }}
                addonAfter={`${currencySymbol} / ${t('models.price.million_tokens')}`}
                onChange={() => autoSave()}
              />
            </Form.Item>
          </div>
        )}
      </Form>
    </Modal>
  )
}

const TypeTitle = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12px 0;
  font-size: 14px;
  font-weight: 600;
`

export default ModelEditContent
