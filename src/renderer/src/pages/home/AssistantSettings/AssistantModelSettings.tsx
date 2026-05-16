import { Button, HelpTooltip, RowFlex, Switch } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CodeEditor from '@renderer/components/CodeEditor'
import EditableNumber from '@renderer/components/EditableNumber'
import { DeleteIcon, ResetIcon } from '@renderer/components/Icons'
import Selector, { ModelSelector } from '@renderer/components/Selector'
import { DEFAULT_TEMPERATURE, MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@renderer/config/constant'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useModelById } from '@renderer/hooks/useModels'
import { useTimer } from '@renderer/hooks/useTimer'
import { SettingRow } from '@renderer/pages/settings'
import { DEFAULT_ASSISTANT_SETTINGS } from '@renderer/services/AssistantService'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { createUniqueModelId, type Model as SharedModel, type UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { Col, Divider, Input, InputNumber, Row, Select, Slider } from 'antd'
import { isNull } from 'lodash'
import { PlusIcon } from 'lucide-react'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type CustomParameter = AssistantSettings['customParameters'][number]

interface Props {
  assistant: Assistant
  updateAssistant: (patch: UpdateAssistantDto) => void
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

const AssistantModelSettings: FC<Props> = ({ assistant, updateAssistant, updateAssistantSettings }) => {
  const [temperature, setTemperature] = useState(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const enableMaxTokens = useMemo(
    () => assistant?.settings?.enableMaxTokens ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens,
    [assistant?.settings?.enableMaxTokens]
  )
  const [maxTokens, setMaxTokens] = useState(assistant?.settings?.maxTokens ?? 0)
  const streamOutput = useMemo(
    () => assistant?.settings?.streamOutput ?? DEFAULT_ASSISTANT_SETTINGS.streamOutput,
    [assistant?.settings?.streamOutput]
  )
  const toolUseMode = useMemo(
    () => assistant?.settings?.toolUseMode ?? DEFAULT_ASSISTANT_SETTINGS.toolUseMode,
    [assistant?.settings?.toolUseMode]
  )
  const [maxToolCalls, setMaxToolCalls] = useState(assistant?.settings?.maxToolCalls ?? 20)
  const enableMaxToolCalls = useMemo(
    () => assistant?.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls,
    [assistant?.settings?.enableMaxToolCalls]
  )
  const { model: apiDefaultModel } = useModelById(assistant?.modelId as UniqueModelId)
  const defaultModel = useMemo(
    () => (apiDefaultModel ? fromSharedModel(apiDefaultModel) : undefined),
    [apiDefaultModel]
  )
  const [topP, setTopP] = useState(assistant?.settings?.topP ?? 1)
  const enableTopP = useMemo(
    () => assistant?.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP,
    [assistant?.settings?.enableTopP]
  )
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>(
    assistant?.settings?.customParameters ?? []
  )
  const enableTemperature = useMemo(
    () => assistant?.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature,
    [assistant?.settings?.enableTemperature]
  )

  const customParametersRef = useRef(customParameters)

  customParametersRef.current = customParameters

  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()

  const onTemperatureChange = (value) => {
    if (!isNaN(value as number)) {
      updateAssistantSettings({ temperature: value })
    }
  }

  const onTopPChange = (value) => {
    if (!isNaN(value as number)) {
      updateAssistantSettings({ topP: value })
    }
  }

  const onAddCustomParameter = () => {
    const newParam = { name: '', value: '', type: 'string' as const }
    const newParams = [...customParameters, newParam]
    setCustomParameters(newParams)
    updateAssistantSettings({ customParameters: newParams })
  }

  const onUpdateCustomParameter = (
    index: number,
    field: 'name' | 'value' | 'type',
    value: string | number | boolean | object
  ) => {
    const newParams = [...customParameters]
    if (field === 'type') {
      let defaultValue: any = ''
      switch (value) {
        case 'number':
          defaultValue = 0
          break
        case 'boolean':
          defaultValue = false
          break
        case 'json':
          defaultValue = ''
          break
        default:
          defaultValue = ''
      }
      newParams[index] = {
        ...newParams[index],
        type: value as any,
        value: defaultValue
      }
    } else {
      newParams[index] = { ...newParams[index], [field]: value }
    }
    setCustomParameters(newParams)
  }

  const renderParameterValueInput = (param: (typeof customParameters)[0], index: number) => {
    switch (param.type) {
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            value={param.value}
            onChange={(value) => onUpdateCustomParameter(index, 'value', value || 0)}
            step={0.01}
          />
        )
      case 'boolean':
        return (
          <Select
            value={param.value}
            onChange={(value) => onUpdateCustomParameter(index, 'value', value)}
            style={{ width: '100%' }}
            options={[
              { label: 'true', value: true },
              { label: 'false', value: false }
            ]}
          />
        )
      case 'json': {
        const jsonValue = typeof param.value === 'string' ? param.value : JSON.stringify(param.value, null, 2)
        let hasJsonError = false
        if (jsonValue.trim()) {
          try {
            JSON.parse(jsonValue)
          } catch {
            hasJsonError = true
          }
        }
        return (
          <>
            <CodeEditor
              value={jsonValue}
              language="json"
              onChange={(value) => onUpdateCustomParameter(index, 'value', value)}
              expanded={false}
              height="auto"
              maxHeight="200px"
              minHeight="60px"
              options={{ lint: true, lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
              style={{
                borderRadius: 6,
                overflow: 'hidden',
                border: `1px solid ${hasJsonError ? 'var(--color-error)' : 'var(--color-border)'}`
              }}
            />
            {hasJsonError && (
              <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 4 }}>
                {t('models.json_parse_error')}
              </div>
            )}
          </>
        )
      }
      default:
        return <Input value={param.value} onChange={(e) => onUpdateCustomParameter(index, 'value', e.target.value)} />
    }
  }

  const onDeleteCustomParameter = (index: number) => {
    const newParams = customParameters.filter((_, i) => i !== index)
    setCustomParameters(newParams)
    updateAssistantSettings({ customParameters: newParams })
  }

  const onReset = () => {
    setTemperature(DEFAULT_ASSISTANT_SETTINGS.temperature)
    setMaxTokens(DEFAULT_ASSISTANT_SETTINGS.maxTokens)
    setTopP(DEFAULT_ASSISTANT_SETTINGS.topP)
    setCustomParameters(DEFAULT_ASSISTANT_SETTINGS.customParameters)
    setMaxToolCalls(DEFAULT_ASSISTANT_SETTINGS.maxToolCalls)
    updateAssistantSettings(DEFAULT_ASSISTANT_SETTINGS)
  }
  const modelFilter = useCallback((m: SharedModel) => !isNonChatModel(m), [])

  const onSelectModel = useCallback(
    (selected: SharedModel | undefined) => {
      if (!selected) return
      const next = fromSharedModel(selected)
      const reasoning = reconcileReasoningEffortForModel(next, assistant.settings.reasoning_effort, assistant.id)
      const webSearch = reconcileWebSearchForModel(next, assistant.settings)
      updateAssistant(
        reasoning || webSearch
          ? {
              modelId: createUniqueModelId(next.provider, next.id),
              settings: { ...assistant.settings, ...reasoning, ...webSearch }
            }
          : { modelId: createUniqueModelId(next.provider, next.id) }
      )
    },
    [assistant.settings, assistant.id, updateAssistant]
  )

  useEffect(() => {
    return () => updateAssistantSettings({ customParameters: customParametersRef.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-1 flex-col p-[5px]">
      <RowFlex className="mb-2.5 items-center justify-between">
        <Label>{t('assistants.settings.default_model')}</Label>
        <RowFlex className="items-center gap-[5px]">
          <ModelSelector
            multiple={false}
            value={apiDefaultModel}
            onSelect={onSelectModel}
            filter={modelFilter}
            trigger={
              <ModelSelectButton>
                {defaultModel ? <ModelAvatar model={defaultModel} size={20} /> : <PlusIcon size={18} />}
                <ModelName>
                  {defaultModel ? defaultModel.name : t('assistants.presets.edit.model.select.title')}
                </ModelName>
              </ModelSelectButton>
            }
          />
          {defaultModel && (
            <Button
              variant="destructive"
              size="icon"
              onClick={() => {
                updateAssistant({ modelId: null })
              }}>
              <DeleteIcon size={14} className="lucide-custom" />
            </Button>
          )}
        </RowFlex>
      </RowFlex>
      <Divider style={{ margin: '10px 0' }} />

      <SettingRow style={{ minHeight: 30 }}>
        <RowFlex className="items-center">
          <Label>
            {t('chat.settings.temperature.label')}
            <HelpTooltip
              content={t('chat.settings.temperature.tip')}
              iconProps={{ className: 'cursor-pointer text-[var(--color-text-3)]' }}
            />
          </Label>
        </RowFlex>
        <Switch
          checked={enableTemperature}
          onCheckedChange={(enabled) => {
            updateAssistantSettings({ enableTemperature: enabled })
          }}
        />
      </SettingRow>
      {enableTemperature && (
        <Row align="middle" gutter={12}>
          <Col span={20}>
            <Slider
              min={0}
              max={2}
              onChange={setTemperature}
              onChangeComplete={onTemperatureChange}
              value={typeof temperature === 'number' ? temperature : 0}
              marks={{ 0: '0', 0.7: '0.7', 2: '2' }}
              step={0.01}
            />
          </Col>
          <Col span={4}>
            <EditableNumber
              min={0}
              max={2}
              step={0.01}
              value={temperature}
              changeOnBlur
              onChange={(value) => {
                if (!isNull(value)) {
                  setTemperature(value)
                  setTimeoutTimer('temperature_onChange', () => updateAssistantSettings({ temperature: value }), 500)
                }
              }}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      )}
      <Divider style={{ margin: '10px 0' }} />

      <SettingRow style={{ minHeight: 30 }}>
        <RowFlex className="items-center">
          <Label>{t('chat.settings.top_p.label')}</Label>
          <HelpTooltip
            content={t('chat.settings.top_p.tip')}
            iconProps={{ className: 'cursor-pointer text-[var(--color-text-3)]' }}
          />
        </RowFlex>
        <Switch
          checked={enableTopP}
          onCheckedChange={(enabled) => {
            updateAssistantSettings({ enableTopP: enabled })
          }}
        />
      </SettingRow>
      {enableTopP && (
        <Row align="middle" gutter={12}>
          <Col span={20}>
            <Slider
              min={0}
              max={1}
              onChange={setTopP}
              onChangeComplete={onTopPChange}
              value={typeof topP === 'number' ? topP : 1}
              marks={{ 0: '0', 1: '1' }}
              step={0.01}
            />
          </Col>
          <Col span={4}>
            <EditableNumber
              min={0}
              max={1}
              step={0.01}
              value={topP}
              changeOnBlur
              onChange={(value) => {
                if (!isNull(value)) {
                  setTopP(value)
                  setTimeoutTimer('topP_onChange', () => updateAssistantSettings({ topP: value }), 500)
                }
              }}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      )}
      <Divider style={{ margin: '10px 0' }} />
      <SettingRow style={{ minHeight: 30 }}>
        <RowFlex className="items-center">
          <Label>{t('chat.settings.max_tokens.label')}</Label>
          <HelpTooltip
            content={t('chat.settings.max_tokens.tip')}
            iconProps={{ className: 'cursor-pointer text-[var(--color-text-3)]' }}
          />
        </RowFlex>
        <Switch
          checked={enableMaxTokens}
          onCheckedChange={async (enabled) => {
            if (enabled) {
              const confirmed = await modalConfirm({
                title: t('chat.settings.max_tokens.confirm'),
                content: t('chat.settings.max_tokens.confirm_content'),
                okButtonProps: {
                  danger: true
                }
              })
              if (!confirmed) return
            }
            updateAssistantSettings({ enableMaxTokens: enabled })
          }}
        />
      </SettingRow>
      {enableMaxTokens && (
        <Row align="middle" style={{ marginTop: 5, marginBottom: 5 }}>
          <Col span={24}>
            <InputNumber
              disabled={!enableMaxTokens}
              min={0}
              max={10000000}
              step={100}
              value={maxTokens}
              changeOnBlur
              onChange={(value) => {
                if (!isNull(value)) {
                  setMaxTokens(value)
                  setTimeoutTimer('maxTokens_onChange', () => updateAssistantSettings({ maxTokens: value }), 1000)
                }
              }}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      )}
      <Divider style={{ margin: '10px 0' }} />
      <SettingRow style={{ minHeight: 30 }}>
        <Label>{t('models.stream_output')}</Label>
        <Switch
          checked={streamOutput}
          onCheckedChange={(checked) => {
            updateAssistantSettings({ streamOutput: checked })
          }}
        />
      </SettingRow>
      <Divider style={{ margin: '10px 0' }} />
      <SettingRow style={{ minHeight: 30 }}>
        <Label>{t('assistants.settings.tool_use_mode.label')}</Label>
        <Selector
          value={toolUseMode}
          options={[
            { label: t('assistants.settings.tool_use_mode.prompt'), value: 'prompt' },
            { label: t('assistants.settings.tool_use_mode.function'), value: 'function' }
          ]}
          onChange={(value) => {
            updateAssistantSettings({ toolUseMode: value })
          }}
          size={14}
        />
      </SettingRow>
      <Divider style={{ margin: '10px 0' }} />
      <SettingRow style={{ minHeight: 30 }}>
        <RowFlex className="items-center">
          <Label>{t('assistants.settings.max_tool_calls.label')}</Label>
          <HelpTooltip
            content={t('assistants.settings.max_tool_calls.tip')}
            iconProps={{ className: 'cursor-pointer text-[var(--color-text-3)]' }}
          />
        </RowFlex>
        <Switch
          checked={enableMaxToolCalls}
          onCheckedChange={(enabled) => {
            updateAssistantSettings({ enableMaxToolCalls: enabled })
          }}
        />
      </SettingRow>
      {enableMaxToolCalls && (
        <Row align="middle" style={{ marginTop: 5, marginBottom: 5 }}>
          <Col span={24}>
            <InputNumber
              min={MIN_TOOL_CALLS}
              max={MAX_TOOL_CALLS}
              step={1}
              value={maxToolCalls}
              onChange={(value) => {
                if (!isNull(value)) {
                  setMaxToolCalls(value)
                  setTimeoutTimer('maxToolCalls_onChange', () => updateAssistantSettings({ maxToolCalls: value }), 500)
                }
              }}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      )}
      <Divider style={{ margin: '10px 0' }} />
      <SettingRow style={{ minHeight: 30 }}>
        <Label>{t('models.custom_parameters')}</Label>
        <Button onClick={onAddCustomParameter}>
          <PlusIcon size={18} />
          {t('models.add_parameter')}
        </Button>
      </SettingRow>
      {customParameters.map((param, index) => (
        <div key={index} style={{ marginTop: 10 }}>
          <Row align="stretch" gutter={10}>
            <Col span={6}>
              <Input
                placeholder={t('models.parameter_name')}
                value={param.name}
                onChange={(e) => onUpdateCustomParameter(index, 'name', e.target.value)}
              />
            </Col>
            <Col span={6}>
              <Select
                value={param.type}
                onChange={(value) => onUpdateCustomParameter(index, 'type', value)}
                style={{ width: '100%' }}>
                <Select.Option value="string">{t('models.parameter_type.string')}</Select.Option>
                <Select.Option value="number">{t('models.parameter_type.number')}</Select.Option>
                <Select.Option value="boolean">{t('models.parameter_type.boolean')}</Select.Option>
                <Select.Option value="json">{t('models.parameter_type.json')}</Select.Option>
              </Select>
            </Col>
            {param.type !== 'json' && <Col span={10}>{renderParameterValueInput(param, index)}</Col>}
            <Col span={param.type === 'json' ? 12 : 2} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="destructive" size="icon-sm" onClick={() => onDeleteCustomParameter(index)}>
                <DeleteIcon size={14} className="lucide-custom" />
              </Button>
            </Col>
          </Row>
          {param.type === 'json' && <div style={{ marginTop: 6 }}>{renderParameterValueInput(param, index)}</div>}
        </div>
      ))}
      <Divider style={{ margin: '15px 0' }} />
      <RowFlex className="justify-end">
        <Button onClick={onReset} variant="destructive">
          <ResetIcon size={16} />
          {t('chat.settings.reset')}
        </Button>
      </RowFlex>
    </div>
  )
}

const Label = ({ className, ...props }: ComponentPropsWithoutRef<'p'>) => (
  <p className={cn('mr-[5px] flex shrink-0 items-center gap-[5px] font-medium', className)} {...props} />
)

const ModelSelectButton = ({ className, ...props }: ComponentPropsWithoutRef<typeof Button>) => (
  <Button className={cn('max-w-[300px] justify-start [&_.ant-btn-icon]:shrink-0', className)} {...props} />
)

const ModelName = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={cn('inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap', className)}
    {...props}
  />
)

export default AssistantModelSettings
