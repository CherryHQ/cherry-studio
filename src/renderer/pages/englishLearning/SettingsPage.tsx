import { Button, Input, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import { ipcApi } from '@renderer/ipc'
import { isUniqueModelId, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { isAudioModel, isNonChatModel } from '@shared/utils/model'
import { ChevronDown, X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function SettingRow({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-border border-b py-4 last:border-0">
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-1 text-muted-foreground text-xs">{description}</div>
      </div>
      <div className="w-56 shrink-0">{children}</div>
    </div>
  )
}

const REALTIME_MODEL_PATTERN = /(?:^|[/:._-])gpt[-_]?realtime(?:$|[/:._-])/i

function isRealtimeModel(model: Model): boolean {
  return REALTIME_MODEL_PATTERN.test(model.apiModelId ?? model.id) || REALTIME_MODEL_PATTERN.test(model.name)
}

function isAudioEvaluationModel(model: Model): boolean {
  return !isNonChatModel(model) && isAudioModel(model)
}

function ModelSettingSelect({
  value,
  onChange,
  placeholder,
  filter
}: {
  value: string | null
  onChange: (value: UniqueModelId | null) => void
  placeholder: string
  filter: (model: Model) => boolean
}) {
  const { models } = useModels({ enabled: true })
  const selectorValue = value && isUniqueModelId(value) ? value : undefined
  const selectedModel = useMemo(
    () => (selectorValue ? models.find((model) => model.id === selectorValue) : undefined),
    [models, selectorValue]
  )

  return (
    <div className="flex items-center gap-1.5">
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={selectorValue}
        filter={filter}
        showTagFilter={false}
        showPinnedModels={false}
        showPinActions={false}
        onSelect={(modelId) => onChange(modelId ?? null)}
        trigger={
          <Button type="button" variant="outline" className="h-8 w-full justify-between gap-2 px-3 font-normal text-sm">
            <span className="min-w-0 truncate text-left">{selectedModel?.name ?? value ?? placeholder}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={placeholder}
          className="size-8 shrink-0"
          onClick={() => onChange(null)}>
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const [reviewTime, setReviewTime] = usePreference('feature.english_learning.review_time')
  const [quietStart, setQuietStart] = usePreference('feature.english_learning.quiet_hours_start')
  const [quietEnd, setQuietEnd] = usePreference('feature.english_learning.quiet_hours_end')
  const [obsidianEnabled, setObsidianEnabled] = usePreference('feature.english_learning.obsidian.enabled')
  const [vaultPath, setVaultPath] = usePreference('feature.english_learning.obsidian.vault_path')
  const [folder, setFolder] = usePreference('feature.english_learning.obsidian.folder')
  const [chatModelId, setChatModelId] = usePreference('feature.english_learning.model.chat_id')
  const [realtimeModelId, setRealtimeModelId] = usePreference('feature.english_learning.model.realtime_id')
  const [pronunciationModelId, setPronunciationModelId] = usePreference(
    'feature.english_learning.model.pronunciation_id'
  )
  const [transcriptionModelId, setTranscriptionModelId] = usePreference(
    'feature.english_learning.model.transcription_id'
  )
  const [synthesisModelId, setSynthesisModelId] = usePreference('feature.english_learning.model.synthesis_id')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-bold text-2xl">{t('english_learning.settings.heading')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('english_learning.settings.description')}</p>
      </div>
      <section className="rounded-xl border border-border bg-card px-5">
        <SettingRow
          title={t('english_learning.settings.review_time')}
          description={t('english_learning.settings.review_time_description')}>
          <Input type="time" value={reviewTime} onChange={(event) => void setReviewTime(event.target.value)} />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.quiet_hours')}
          description={t('english_learning.settings.quiet_hours_description')}>
          <div className="flex gap-2">
            <Input type="time" value={quietStart} onChange={(event) => void setQuietStart(event.target.value)} />
            <Input type="time" value={quietEnd} onChange={(event) => void setQuietEnd(event.target.value)} />
          </div>
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.snooze')}
          description={t('english_learning.settings.snooze_description')}>
          <Button variant="outline" onClick={() => void ipcApi.request('english_learning.reminder.snooze', {})}>
            {t('english_learning.settings.snooze_action')}
          </Button>
        </SettingRow>
      </section>
      <section className="rounded-xl border border-border bg-card px-5">
        <SettingRow
          title={t('english_learning.settings.chat_model')}
          description={t('english_learning.settings.chat_model_description')}>
          <ModelSettingSelect
            value={chatModelId}
            onChange={(modelId) => void setChatModelId(modelId)}
            placeholder={t('english_learning.settings.model_placeholder')}
            filter={(model) => !isNonChatModel(model)}
          />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.realtime_model')}
          description={t('english_learning.settings.realtime_model_description')}>
          <ModelSettingSelect
            value={realtimeModelId}
            onChange={(modelId) => void setRealtimeModelId(modelId)}
            placeholder={t('english_learning.settings.model_placeholder')}
            filter={isRealtimeModel}
          />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.pronunciation_model')}
          description={t('english_learning.settings.pronunciation_model_description')}>
          <ModelSettingSelect
            value={pronunciationModelId}
            onChange={(modelId) => void setPronunciationModelId(modelId)}
            placeholder={t('english_learning.settings.model_placeholder')}
            filter={isAudioEvaluationModel}
          />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.transcription_model')}
          description={t('english_learning.settings.transcription_model_description')}>
          <ModelSettingSelect
            value={transcriptionModelId}
            onChange={(modelId) => void setTranscriptionModelId(modelId)}
            placeholder={t('english_learning.settings.model_placeholder')}
            filter={(model) => model.capabilities.includes(MODEL_CAPABILITY.AUDIO_TRANSCRIPT)}
          />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.synthesis_model')}
          description={t('english_learning.settings.synthesis_model_description')}>
          <ModelSettingSelect
            value={synthesisModelId}
            onChange={(modelId) => void setSynthesisModelId(modelId)}
            placeholder={t('english_learning.settings.model_placeholder')}
            filter={(model) => model.capabilities.includes(MODEL_CAPABILITY.AUDIO_GENERATION)}
          />
        </SettingRow>
      </section>
      <section className="rounded-xl border border-border bg-card px-5">
        <SettingRow
          title={t('english_learning.settings.obsidian')}
          description={t('english_learning.settings.obsidian_description')}>
          <div className="flex justify-end">
            <Switch checked={obsidianEnabled} onCheckedChange={(checked) => void setObsidianEnabled(checked)} />
          </div>
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.vault_path')}
          description={t('english_learning.settings.vault_path_description')}>
          <Input value={vaultPath} onChange={(event) => void setVaultPath(event.target.value)} />
        </SettingRow>
        <SettingRow
          title={t('english_learning.settings.folder')}
          description={t('english_learning.settings.folder_description')}>
          <Input value={folder} onChange={(event) => void setFolder(event.target.value)} />
        </SettingRow>
      </section>
    </div>
  )
}
