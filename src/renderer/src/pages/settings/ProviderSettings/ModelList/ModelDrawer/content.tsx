import { Button, WarnTooltip } from '@cherrystudio/ui'
import {
  EmbeddingTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/Model'
import { cn } from '@renderer/utils'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderField from '../../primitives/ProviderField'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import { ModelEndpointTypeChips } from './ModelEndpointTypeChips'
import type { ModelBasicFormState, ModelCapabilityToggle, ModelDrawerEndpointType } from './types'

interface ModelBasicFieldsProps {
  values: ModelBasicFormState
  showEndpointType: boolean
  modelIdDisabled?: boolean
  modelIdAction?: ReactNode
  endpointTypeError?: string
  onModelIdChange: (value: string) => void
  onNameChange: (value: string) => void
  onGroupChange: (value: string) => void
  onEndpointTypesChange: (next: readonly ModelDrawerEndpointType[]) => void
}

const drawerFieldTitleClassName = 'text-[13px] text-foreground/85'

export function ModelBasicFields({
  values,
  showEndpointType,
  modelIdDisabled = false,
  modelIdAction,
  endpointTypeError,
  onModelIdChange,
  onNameChange,
  onGroupChange,
  onEndpointTypesChange
}: ModelBasicFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProviderField title={t('settings.models.add.model_id.label')} titleClassName={drawerFieldTitleClassName}>
        <div className={drawerClasses.valueRow}>
          <input
            required
            spellCheck={false}
            maxLength={200}
            aria-label={t('settings.models.add.model_id.label')}
            value={values.modelId}
            disabled={modelIdDisabled}
            placeholder={t('settings.models.add.model_id.placeholder')}
            className={cn(drawerClasses.input, modelIdDisabled && drawerClasses.inputDisabled)}
            onChange={(event) => onModelIdChange(event.target.value)}
          />
          {modelIdAction}
        </div>
      </ProviderField>

      <ProviderField title={t('settings.models.add.model_name.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          spellCheck={false}
          aria-label={t('settings.models.add.model_name.label')}
          value={values.name}
          placeholder={t('settings.models.add.model_name.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </ProviderField>

      <ProviderField title={t('settings.models.add.group_name.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          spellCheck={false}
          aria-label={t('settings.models.add.group_name.label')}
          value={values.group}
          placeholder={t('settings.models.add.group_name.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onGroupChange(event.target.value)}
        />
      </ProviderField>

      {showEndpointType && (
        <ProviderField
          title={t('settings.models.add.endpoint_type.label')}
          titleClassName={drawerFieldTitleClassName}
          help={endpointTypeError ? <div className={drawerClasses.errorText}>{endpointTypeError}</div> : null}>
          <div data-testid="provider-settings-model-endpoint-type-field">
            <ModelEndpointTypeChips value={values.endpointTypes ?? []} onChange={onEndpointTypesChange} />
          </div>
        </ProviderField>
      )}
    </>
  )
}

interface ModelContextWindowFieldsProps {
  contextWindow: string
  maxInputTokens: string
  maxOutputTokens: string
  onContextWindowChange: (value: string) => void
  onMaxInputTokensChange: (value: string) => void
  onMaxOutputTokensChange: (value: string) => void
}

export function ModelContextWindowFields({
  contextWindow,
  maxInputTokens,
  maxOutputTokens,
  onContextWindowChange,
  onMaxInputTokensChange,
  onMaxOutputTokensChange
}: ModelContextWindowFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProviderField title={t('settings.models.add.context_window.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.context_window.label')}
          value={contextWindow}
          placeholder={t('settings.models.add.context_window.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onContextWindowChange(event.target.value.replace(/[^\d]/g, ''))}
        />
      </ProviderField>

      <ProviderField title={t('settings.models.add.max_input_tokens.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.max_input_tokens.label')}
          value={maxInputTokens}
          placeholder={t('settings.models.add.max_input_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onMaxInputTokensChange(event.target.value.replace(/[^\d]/g, ''))}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.max_output_tokens.label')}
        titleClassName={drawerFieldTitleClassName}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.max_output_tokens.label')}
          value={maxOutputTokens}
          placeholder={t('settings.models.add.max_output_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onMaxOutputTokensChange(event.target.value.replace(/[^\d]/g, ''))}
        />
      </ProviderField>
    </>
  )
}

interface ModelCapabilityTogglesProps {
  selectedCaps: Set<ModelCapabilityToggle>
  hasUserModified: boolean
  onToggle: (type: ModelCapabilityToggle) => void
  onReset: () => void
}

export function ModelCapabilityToggles({
  selectedCaps,
  hasUserModified,
  onToggle,
  onReset
}: ModelCapabilityTogglesProps) {
  const { t } = useTranslation()
  const isRerankDisabled = selectedCaps.has(MODEL_CAPABILITY.EMBEDDING)
  const isEmbeddingDisabled = selectedCaps.has(MODEL_CAPABILITY.RERANK)
  const isOtherDisabled = selectedCaps.has(MODEL_CAPABILITY.RERANK) || selectedCaps.has(MODEL_CAPABILITY.EMBEDDING)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 font-[weight:var(--font-weight-semibold)] text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
          {t('models.type.select')}
          <WarnTooltip content={t('settings.moresetting.check.warn')} />
        </div>
        {hasUserModified && (
          <Button variant="ghost" size="icon-sm" onClick={onReset}>
            <RotateCcw size={14} />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <VisionTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.IMAGE_RECOGNITION)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.IMAGE_RECOGNITION)}
        />
        <WebSearchTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.WEB_SEARCH)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.WEB_SEARCH)}
        />
        <ReasoningTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.REASONING)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.REASONING)}
        />
        <ToolsCallingTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.FUNCTION_CALL)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.FUNCTION_CALL)}
        />
        <RerankerTag
          disabled={isRerankDisabled}
          inactive={isRerankDisabled || !selectedCaps.has(MODEL_CAPABILITY.RERANK)}
          onClick={() => onToggle(MODEL_CAPABILITY.RERANK)}
        />
        <EmbeddingTag
          disabled={isEmbeddingDisabled}
          inactive={isEmbeddingDisabled || !selectedCaps.has(MODEL_CAPABILITY.EMBEDDING)}
          onClick={() => onToggle(MODEL_CAPABILITY.EMBEDDING)}
        />
      </div>
    </div>
  )
}
