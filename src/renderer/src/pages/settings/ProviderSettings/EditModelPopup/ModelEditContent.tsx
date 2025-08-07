import CopyIcon from '@renderer/components/Icons/CopyIcon'
import {
  EmbeddingTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/ModelCapabilities'
import WarnTooltip from '@renderer/components/WarnTooltip'
import { endpointTypeOptions } from '@renderer/config/endpointTypes'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { useDynamicLabelWidth } from '@renderer/hooks/useDynamicLabelWidth'
import { Model, ModelCapability, ModelType, Provider } from '@renderer/types'
import { getDefaultGroupName, getDifference, getUnion, uniqueObjectArray } from '@renderer/utils'
import {
  Button,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  ModalProps,
  Select,
  Switch,
  Tooltip
} from 'antd'
import { cloneDeep } from 'lodash'
import { ChevronDown, ChevronUp, RotateCcw, SaveIcon } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ModelEditContentProps {
  provider: Provider
  model: Model
  onUpdateModel: (model: Model) => void
}

const symbols = ['$', '¥', '€', '£']
const ModelEditContent: FC<ModelEditContentProps & ModalProps> = ({ provider, model, onUpdateModel, ...props }) => {
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [currencySymbol, setCurrencySymbol] = useState(model.pricing?.currencySymbol || '$')
  const [isCustomCurrency, setIsCustomCurrency] = useState(!symbols.includes(model.pricing?.currencySymbol || '$'))
  const [modelCapabilities, setModelCapabilities] = useState(model.capabilities || [])
  const originalModelCapabilities = cloneDeep(model.capabilities || [])
  const [supportedTextDelta, setSupportedTextDelta] = useState(model.supported_text_delta)
  const [hasUserModified, setHasUserModified] = useState(false)

  const labelWidth = useDynamicLabelWidth([t('settings.models.add.endpoint_type.label')])

  // 自动保存函数
  const autoSave = (overrides?: {
    capabilities?: ModelCapability[]
    supported_text_delta?: boolean
    currencySymbol?: string
    isCustomCurrency?: boolean
  }) => {
    const formValues = form.getFieldsValue()
    const currentIsCustomCurrency = overrides?.isCustomCurrency ?? isCustomCurrency
    const currentCurrencySymbol = overrides?.currencySymbol ?? currencySymbol
    const finalCurrencySymbol = currentIsCustomCurrency
      ? formValues.customCurrencySymbol || currentCurrencySymbol
      : formValues.currencySymbol || currentCurrencySymbol || '$'
    const updatedModel: Model = {
      ...model,
      id: formValues.id || model.id,
      name: formValues.name || model.name,
      group: formValues.group || model.group,
      endpoint_type: provider.id === 'new-api' ? formValues.endpointType : model.endpoint_type,
      capabilities: overrides?.capabilities ?? modelCapabilities,
      supported_text_delta: overrides?.supported_text_delta ?? supportedTextDelta,
      pricing: {
        input_per_million_tokens: Number(formValues.input_per_million_tokens) || 0,
        output_per_million_tokens: Number(formValues.output_per_million_tokens) || 0,
        currencySymbol: finalCurrencySymbol
      }
    }
    onUpdateModel(updatedModel)
  }

  const onFinish = (values: any) => {
    const finalCurrencySymbol = isCustomCurrency ? values.customCurrencySymbol : values.currencySymbol
    const updatedModel: Model = {
      ...model,
      id: values.id || model.id,
      name: values.name || model.name,
      group: values.group || model.group,
      endpoint_type: provider.id === 'new-api' ? values.endpointType : model.endpoint_type,
      capabilities: modelCapabilities,
      supported_text_delta: supportedTextDelta,
      pricing: {
        input_per_million_tokens: Number(values.input_per_million_tokens) || 0,
        output_per_million_tokens: Number(values.output_per_million_tokens) || 0,
        currencySymbol: finalCurrencySymbol || '$'
      }
    }
    onUpdateModel(updatedModel)
    setShowMoreSettings(false)
    props.onOk?.(undefined as any)
  }

  const currencyOptions = [
    ...symbols.map((symbol) => ({ label: symbol, value: symbol })),
    { label: t('models.price.custom'), value: 'custom' }
  ]

  const defaultTypes: ModelType[] = useMemo(
    () => [
      ...(isVisionModel(model) ? (['vision'] as const) : []),
      ...(isReasoningModel(model) ? (['reasoning'] as const) : []),
      ...(isFunctionCallingModel(model) ? (['function_calling'] as const) : []),
      ...(isWebSearchModel(model) ? (['web_search'] as const) : []),
      ...(isEmbeddingModel(model) ? (['embedding'] as const) : []),
      ...(isRerankModel(model) ? (['rerank'] as const) : [])
    ],
    [model]
  )

  const selectedTypes: ModelType[] = useMemo(
    () =>
      getUnion(
        modelCapabilities?.filter((t) => t.isUserSelected).map((t) => t.type) || [],
        getDifference(
          defaultTypes,
          modelCapabilities?.filter((t) => t.isUserSelected === false).map((t) => t.type) || []
        )
      ),
    [defaultTypes, modelCapabilities]
  )

  // 被rerank/embedding改变的类型
  // const changedTypesRef = useRef<string[]>([])

  useEffect(() => {
    if (showMoreSettings) {
      const newModelCapabilities = getUnion(
        selectedTypes.map((type) => {
          const existingCapability = modelCapabilities?.find((m) => m.type === type)
          return {
            type: type as ModelType,
            isUserSelected: existingCapability?.isUserSelected ?? undefined
          }
        }),
        modelCapabilities?.filter((t) => t.isUserSelected === false),
        (item) => item.type
      )
      setModelCapabilities(newModelCapabilities)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMoreSettings])

  // 监听modelCapabilities变化，自动保存（但跳过初始化时的保存）
  useEffect(() => {
    if (hasUserModified && showMoreSettings) {
      autoSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelCapabilities])

  const ModelCapability = () => {
    const isRerankDisabled = selectedTypes.includes('embedding')
    const isEmbeddingDisabled = selectedTypes.includes('rerank')
    const isOtherDisabled = selectedTypes.includes('rerank') || selectedTypes.includes('embedding')

    const handleResetTypes = () => {
      setModelCapabilities(originalModelCapabilities)
      setHasUserModified(false) // 重置后清除修改标志
    }

    const updateType = useCallback((type: ModelType) => {
      setHasUserModified(true)
      setModelCapabilities((prev) =>
        uniqueObjectArray([
          ...prev.filter((t) => t.type !== type),
          { type, isUserSelected: !selectedTypes.includes(type) }
        ])
      )
    }, [])

    return (
      <>
        <TypeTitle>
          <Flex align="center" gap={4} style={{ height: 24 }}>
            {t('models.type.select')}
            <WarnTooltip title={t('settings.moresetting.check.warn')} />
          </Flex>

          {hasUserModified && (
            <Tooltip title={t('common.reset')}>
              <Button size="small" icon={<RotateCcw size={14} />} onClick={handleResetTypes} type="text" />
            </Tooltip>
          )}
        </TypeTitle>
        <Flex justify="flex-start" align="center" gap={4} wrap={'wrap'} style={{ marginBottom: 8 }}>
          <VisionTag
            showLabel
            inactive={isOtherDisabled || !selectedTypes.includes('vision')}
            disabled={isOtherDisabled}
            onClick={() => updateType('vision')}
          />
          <WebSearchTag
            showLabel
            inactive={isOtherDisabled || !selectedTypes.includes('web_search')}
            disabled={isOtherDisabled}
            onClick={() => updateType('web_search')}
          />
          <ReasoningTag
            showLabel
            inactive={isOtherDisabled || !selectedTypes.includes('reasoning')}
            disabled={isOtherDisabled}
            onClick={() => updateType('reasoning')}
          />
          <ToolsCallingTag
            showLabel
            inactive={isOtherDisabled || !selectedTypes.includes('function_calling')}
            disabled={isOtherDisabled}
            onClick={() => updateType('function_calling')}
          />
          <RerankerTag
            disabled={isRerankDisabled}
            inactive={isRerankDisabled || !selectedTypes.includes('rerank')}
            onClick={() => updateType('rerank')}
          />
          <EmbeddingTag
            inactive={isEmbeddingDisabled || !selectedTypes.includes('embedding')}
            disabled={isEmbeddingDisabled}
            onClick={() => updateType('embedding')}
          />
        </Flex>
      </>
    )
  }

  return (
    <Modal title={t('models.edit')} footer={null} transitionName="animation-move-down" centered {...props}>
      <Form
        form={form}
        labelCol={{ flex: provider.id === 'new-api' ? labelWidth : '110px' }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 15 }}
        initialValues={{
          id: model.id,
          name: model.name,
          group: model.group,
          endpointType: model.endpoint_type,
          input_per_million_tokens: model.pricing?.input_per_million_tokens ?? 0,
          output_per_million_tokens: model.pricing?.output_per_million_tokens ?? 0,
          currencySymbol: symbols.includes(model.pricing?.currencySymbol || '$')
            ? model.pricing?.currencySymbol || '$'
            : 'custom',
          customCurrencySymbol: symbols.includes(model.pricing?.currencySymbol || '$')
            ? ''
            : model.pricing?.currencySymbol || ''
        }}
        onFinish={onFinish}>
        <Form.Item
          name="id"
          label={t('settings.models.add.model_id.label')}
          tooltip={t('settings.models.add.model_id.tooltip')}
          rules={[{ required: true }]}>
          <Flex justify="space-between" gap={5}>
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
                    navigator.clipboard.writeText((val.id || model.id) as string)
                    message.success(t('message.copied'))
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
        {provider.id === 'new-api' && (
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
          <Flex justify="space-between" align="center" style={{ position: 'relative' }}>
            <Button
              color="default"
              variant="filled"
              icon={showMoreSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              iconPosition="end"
              onClick={() => setShowMoreSettings(!showMoreSettings)}
              style={{ color: 'var(--color-text-3)' }}>
              {t('settings.moresetting.label')}
            </Button>
            <Button type="primary" htmlType="submit" icon={<SaveIcon size={16} />}>
              {t('common.save')}
            </Button>
          </Flex>
        </Form.Item>
        {showMoreSettings && (
          <div style={{ marginBottom: 8 }}>
            <Divider style={{ margin: '16px 0 16px 0' }} />
            <ModelCapability />
            <Divider style={{ margin: '16px 0 12px 0' }} />
            <Form.Item
              name="supported_text_delta"
              style={{ marginBottom: 10 }}
              labelCol={{ flex: 1 }}
              label={t('settings.models.add.supported_text_delta.label')}
              tooltip={t('settings.models.add.supported_text_delta.tooltip')}>
              <Switch
                checked={supportedTextDelta}
                style={{ marginLeft: 'auto' }}
                size="small"
                onChange={(checked) => {
                  setSupportedTextDelta(checked)
                  // 直接传递新值给autoSave
                  autoSave({ supported_text_delta: checked })
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
                    // 自动保存
                    autoSave({
                      isCustomCurrency: true,
                      currencySymbol: customSymbol
                    })
                  } else {
                    setIsCustomCurrency(false)
                    setCurrencySymbol(value)
                    // 自动保存
                    autoSave({
                      isCustomCurrency: false,
                      currencySymbol: value
                    })
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
                  defaultValue={model.pricing?.currencySymbol}
                  maxLength={5}
                  onChange={(e) => {
                    const newValue = e.target.value
                    setCurrencySymbol(newValue)
                    // 自动保存
                    autoSave({
                      currencySymbol: newValue,
                      isCustomCurrency: true
                    })
                  }}
                />
              </Form.Item>
            )}

            <Form.Item label={t('models.price.input')} style={{ marginBottom: 10 }} name="input_per_million_tokens">
              <InputNumber
                placeholder="0.00"
                defaultValue={model.pricing?.input_per_million_tokens}
                min={0}
                step={0.01}
                precision={2}
                style={{ width: '240px' }}
                addonAfter={`${currencySymbol} / ${t('models.price.million_tokens')}`}
                onChange={() => {
                  // 自动保存
                  autoSave()
                }}
              />
            </Form.Item>
            <Form.Item label={t('models.price.output')} style={{ marginBottom: 10 }} name="output_per_million_tokens">
              <InputNumber
                placeholder="0.00"
                defaultValue={model.pricing?.output_per_million_tokens}
                min={0}
                step={0.01}
                precision={2}
                style={{ width: '240px' }}
                addonAfter={`${currencySymbol} / ${t('models.price.million_tokens')}`}
                onChange={() => {
                  // 自动保存
                  autoSave()
                }}
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
