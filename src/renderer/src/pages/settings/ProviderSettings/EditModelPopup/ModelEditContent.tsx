import CopyIcon from '@renderer/components/Icons/CopyIcon'
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
  Checkbox,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  ModalProps,
  Select,
  Switch
} from 'antd'
import { cloneDeep } from 'lodash'
import { ChevronDown, ChevronUp, SaveIcon } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'
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

  const defaultTypes = [
    ...(isVisionModel(model) ? ['vision'] : []),
    ...(isReasoningModel(model) ? ['reasoning'] : []),
    ...(isFunctionCallingModel(model) ? ['function_calling'] : []),
    ...(isWebSearchModel(model) ? ['web_search'] : []),
    ...(isEmbeddingModel(model) ? ['embedding'] : []),
    ...(isRerankModel(model) ? ['rerank'] : [])
  ]

  const selectedTypes: string[] = getUnion(
    modelCapabilities?.filter((t) => t.isUserSelected).map((t) => t.type) || [],
    getDifference(defaultTypes, modelCapabilities?.filter((t) => t.isUserSelected === false).map((t) => t.type) || [])
  )

  // 被rerank/embedding改变的类型
  const changedTypesRef = useRef<string[]>([])

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
    const isDisabled = selectedTypes.includes('rerank') || selectedTypes.includes('embedding')

    const isRerankDisabled = selectedTypes.includes('embedding')
    const isEmbeddingDisabled = selectedTypes.includes('rerank')
    const showTypeConfirmModal = (newCapability: ModelCapability) => {
      const onUpdateType = selectedTypes?.find((t) => t === newCapability.type)
      window.modal.confirm({
        title: t('settings.moresetting.warn'),
        content: t('settings.moresetting.check.warn'),
        okText: t('settings.moresetting.check.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        cancelButtonProps: { type: 'primary' },
        onOk: () => {
          if (onUpdateType) {
            const updatedModelCapabilities = modelCapabilities?.map((t) => {
              if (t.type === newCapability.type) {
                return { ...t, isUserSelected: true }
              }
              if (
                ((onUpdateType !== t.type && onUpdateType === 'rerank') ||
                  (onUpdateType === 'embedding' && onUpdateType !== t.type)) &&
                t.isUserSelected !== false
              ) {
                changedTypesRef.current.push(t.type)
                return { ...t, isUserSelected: false }
              }
              return t
            })
            setModelCapabilities(uniqueObjectArray(updatedModelCapabilities as ModelCapability[]))
          } else {
            const updatedModelCapabilities = modelCapabilities?.map((t) => {
              if (
                ((newCapability.type !== t.type && newCapability.type === 'rerank') ||
                  (newCapability.type === 'embedding' && newCapability.type !== t.type)) &&
                t.isUserSelected !== false
              ) {
                changedTypesRef.current.push(t.type)
                return { ...t, isUserSelected: false }
              }
              if (newCapability.type === t.type) {
                return { ...t, isUserSelected: true }
              }
              return t
            })
            updatedModelCapabilities.push(newCapability as any)
            setModelCapabilities(uniqueObjectArray(updatedModelCapabilities as ModelCapability[]))
          }
        },
        onCancel: () => {},
        centered: true
      })
    }

    const handleTypeChange = (types: string[]) => {
      setHasUserModified(true) // 标记用户已进行修改
      const diff = types.length > selectedTypes.length
      if (diff) {
        const newCapability = getDifference(types, selectedTypes) // checkbox的特性，确保了newCapability只有一个元素
        showTypeConfirmModal({
          type: newCapability[0] as ModelType,
          isUserSelected: true
        })
      } else {
        const disabledTypes = getDifference(selectedTypes, types)
        const onUpdateType = modelCapabilities?.find((t) => t.type === disabledTypes[0])
        if (onUpdateType) {
          const updatedTypes = modelCapabilities?.map((t) => {
            if (t.type === disabledTypes[0]) {
              return { ...t, isUserSelected: false }
            }
            if (
              ((onUpdateType !== t && onUpdateType.type === 'rerank') ||
                (onUpdateType.type === 'embedding' && onUpdateType !== t)) &&
              t.isUserSelected === false
            ) {
              if (changedTypesRef.current.includes(t.type)) {
                return { ...t, isUserSelected: true }
              }
            }
            return t
          })
          setModelCapabilities(uniqueObjectArray(updatedTypes as ModelCapability[]))
        } else {
          const updatedModelCapabilities = modelCapabilities?.map((t) => {
            if (
              (disabledTypes[0] === 'rerank' && t.type !== 'rerank') ||
              (disabledTypes[0] === 'embedding' && t.type !== 'embedding' && t.isUserSelected === false)
            ) {
              return { ...t, isUserSelected: true }
            }
            return t
          })
          updatedModelCapabilities.push({ type: disabledTypes[0] as ModelType, isUserSelected: false })
          setModelCapabilities(uniqueObjectArray(updatedModelCapabilities as ModelCapability[]))
        }
        changedTypesRef.current.length = 0
      }
    }

    const handleResetTypes = () => {
      setModelCapabilities(originalModelCapabilities)
      setHasUserModified(false) // 重置后清除修改标志
    }

    return (
      <div>
        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          <Checkbox.Group
            value={selectedTypes}
            onChange={handleTypeChange}
            options={[
              {
                label: t('models.type.vision'),
                value: 'vision',
                disabled: isDisabled
              },
              {
                label: t('models.type.websearch'),
                value: 'web_search',
                disabled: isDisabled
              },
              {
                label: t('models.type.rerank'),
                value: 'rerank',
                disabled: isRerankDisabled
              },
              {
                label: t('models.type.embedding'),
                value: 'embedding',
                disabled: isEmbeddingDisabled
              },
              {
                label: t('models.type.reasoning'),
                value: 'reasoning',
                disabled: isDisabled
              },
              {
                label: t('models.type.function_calling'),
                value: 'function_calling',
                disabled: isDisabled
              }
            ]}
          />
          {hasUserModified && (
            <Button size="small" onClick={handleResetTypes}>
              {t('common.reset')}
            </Button>
          )}
        </Flex>
      </div>
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
            <TypeTitle>{t('models.type.select')}</TypeTitle>
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
  margin: 12px 0;
  font-size: 14px;
  font-weight: 600;
`

export default ModelEditContent
