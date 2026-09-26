import { Copy, Download, Mic, Play, Square, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Combobox,
  type ComboboxOption,
  InputNumber,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useFunAsrModel } from '@renderer/hooks/useFunAsrModel'
import { useTheme } from '@renderer/hooks/useTheme'
import { popup } from '@renderer/services/popup'
import {
  dictationService,
  type DictationPhase,
  speechPlaybackService,
  voiceService,
  voiceTargetManager
} from '@renderer/services/voice'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  DEFAULT_APPLE_ASR_LOCALE,
  FUNASR_MODEL_ID,
  type LocalVoiceModelFacts,
  type LocalVoiceModelId,
  type LocalTranscriptionModelId
} from '@shared/ai/localVoice'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

type ModelStatus = 'unsupported' | 'not_installed' | 'installing' | 'ready' | 'failed' | 'unconfigured'

interface StatusState {
  status: ModelStatus
  reason?: VoiceErrorReason
}

interface QueriedRecognitionStatus {
  modelId: LocalTranscriptionModelId
  language: string
  result: StatusState
}

type FunAsrAction = 'download' | 'cancel' | 'remove'

const EMPTY_VALUE = '__unconfigured__'
const RECOGNITION_PREFERENCE_KEYS = {
  modelId: 'feature.voice.recognition.model_id',
  language: 'feature.voice.recognition.language'
} as const
const SPEECH_PREFERENCE_KEYS = {
  voiceId: 'feature.voice.speech.voice_id',
  language: 'feature.voice.speech.language'
} as const
const MODEL_LABEL_KEYS: Record<LocalVoiceModelId, string> = {
  [APPLE_ASR_MODEL_ID]: 'settings.voice.model.apple_asr',
  [APPLE_TTS_MODEL_ID]: 'settings.voice.model.apple_tts',
  [FUNASR_MODEL_ID]: 'settings.voice.model.funasr'
}
const DICTATION_PHASE_LABEL_KEYS: Record<Exclude<DictationPhase, 'idle'>, string> = {
  failed: 'settings.voice.dictation.phase.failed',
  recording: 'settings.voice.dictation.phase.recording',
  recovery: 'settings.voice.dictation.phase.recovery',
  starting: 'settings.voice.dictation.phase.starting',
  stopping: 'settings.voice.dictation.phase.stopping',
  transcribing: 'settings.voice.dictation.phase.transcribing'
}

function statusKey(status: StatusState): string {
  if (status.status === 'installing') return 'settings.voice.status.installing'
  if (
    status.reason &&
    [
      'asset_required',
      'download_failed',
      'model_load_failed',
      'model_required',
      'voice_unavailable',
      'worker_crashed'
    ].includes(status.reason)
  )
    return `settings.voice.status.${status.reason}`
  return `settings.voice.status.${status.status}`
}

function errorKey(error: boolean | string): string {
  if (
    typeof error === 'string' &&
    ['download_failed', 'model_load_failed', 'no_speech', 'worker_crashed', 'timeout'].includes(error)
  )
    return `settings.voice.status.${error}`
  return 'settings.voice.status.operation_failed'
}

function optionalValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed || undefined
}

function languageValue(value: string | null | undefined): string | undefined {
  const language = optionalValue(value)
  return language?.toLowerCase() === 'auto' ? undefined : language
}

function transcriptionModelId(value: string | null | undefined): LocalTranscriptionModelId | undefined {
  return value === APPLE_ASR_MODEL_ID || value === FUNASR_MODEL_ID ? value : undefined
}

function funAsrStatusState(model: Pick<ReturnType<typeof useFunAsrModel>, 'isStatusResolved' | 'status'>): StatusState {
  if (!model.isStatusResolved) return { status: 'unconfigured' }
  switch (model.status) {
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return { status: 'installing', reason: 'model_required' }
    case 'ready':
      return { status: 'ready' }
    case 'error':
      return { status: 'failed', reason: 'download_failed' }
    case 'unsupported':
      return { status: 'unsupported', reason: 'unsupported' }
  }
}

function VoiceSettings() {
  const { t, i18n } = useTranslation()
  const { theme } = useTheme()
  const [recognitionPreferences, setRecognitionPreferences] = useMultiplePreferences(RECOGNITION_PREFERENCE_KEYS)
  const { language: recognitionLanguage, modelId: recognitionModel } = recognitionPreferences
  const [speechModel, setSpeechModel] = usePreference('feature.voice.speech.model_id')
  const [speechPreferences, setSpeechPreferences] = useMultiplePreferences(SPEECH_PREFERENCE_KEYS)
  const { voiceId: speechVoice, language: speechLanguage } = speechPreferences
  const [speechSpeed, setSpeechSpeed] = usePreference('feature.voice.speech.speed')
  const [autoRead, setAutoRead] = usePreference('feature.voice.auto_read.enabled')
  const [disclosureConfirmed, setDisclosureConfirmed] = usePreference('feature.voice.auto_read.disclosure_confirmed')
  const dictation = useSyncExternalStore(
    dictationService.subscribe,
    dictationService.getSnapshot,
    dictationService.getSnapshot
  )
  const speech = useSyncExternalStore(
    speechPlaybackService.subscribe,
    speechPlaybackService.getSnapshot,
    speechPlaybackService.getSnapshot
  )
  const funAsrModel = useFunAsrModel()
  const [models, setModels] = useState<readonly LocalVoiceModelFacts[]>([])
  const [asrLocales, setAsrLocales] = useState<Awaited<ReturnType<typeof voiceService.listTranscriptionLocales>>>()
  const [defaultAsrModel, setDefaultAsrModel] = useState<LocalTranscriptionModelId>()
  const [voices, setVoices] = useState<readonly { id: string; name: string; language: string }[]>([])
  const [queriedRecognitionStatus, setQueriedRecognitionStatus] = useState<QueriedRecognitionStatus>()
  const [speechStatus, setSpeechStatus] = useState<StatusState>({ status: 'unconfigured' })
  const [microphoneStatus, setMicrophoneStatus] =
    useState<Awaited<ReturnType<typeof voiceService.getMicrophoneStatus>>>('unknown')
  const [installing, setInstalling] = useState(false)
  const [pendingFunAsrAction, setPendingFunAsrAction] = useState<FunAsrAction>()
  const [actionFailed, setActionFailed] = useState<boolean | VoiceErrorReason>(false)
  const [transcript, setTranscript] = useState('')
  const [previewText, setPreviewText] = useState('')
  const transcriptRef = useRef<HTMLTextAreaElement>(null)
  const transcriptValueRef = useRef('')
  const autoReadRef = useRef<HTMLButtonElement>(null)
  const dictationRunRef = useRef<ReturnType<typeof dictationService.startScoped> | undefined>(undefined)

  transcriptValueRef.current = transcript

  useEffect(() => {
    let current = true
    void voiceService
      .initialize()
      .then(async () => {
        const [modelResult, localeResult, voiceResult, microphoneResult] = await Promise.allSettled([
          voiceService.listModels(),
          voiceService.listTranscriptionLocales(),
          voiceService.listVoices(),
          voiceService.getMicrophoneStatus()
        ])
        if (!current) return
        if (modelResult.status === 'fulfilled') {
          setModels(modelResult.value.models)
          setDefaultAsrModel(modelResult.value.defaultAsrModelId)
        }
        if (localeResult.status === 'fulfilled') setAsrLocales(localeResult.value)
        if (voiceResult.status === 'fulfilled') setVoices(voiceResult.value)
        if (microphoneResult.status === 'fulfilled') setMicrophoneStatus(microphoneResult.value)
      })
      .catch(() => {
        if (current) setActionFailed(true)
      })
    return () => {
      current = false
    }
  }, [])

  const configuredRecognitionModel = transcriptionModelId(recognitionModel)
  const hasConfiguredRecognitionModel = optionalValue(recognitionModel) !== undefined
  const effectiveRecognitionModel = hasConfiguredRecognitionModel ? configuredRecognitionModel : defaultAsrModel
  const funAsrSelected = effectiveRecognitionModel === FUNASR_MODEL_ID
  const effectiveRecognitionLanguage = languageValue(recognitionLanguage) ?? DEFAULT_APPLE_ASR_LOCALE
  const selectedVoice = voices.find((voice) => voice.id === speechVoice)
  const effectiveSpeechLanguage = selectedVoice?.language ?? languageValue(speechLanguage) ?? ''
  const speechLanguageOptions = useMemo<ComboboxOption[]>(() => {
    const displayNames = new Intl.DisplayNames([i18n.language], { type: 'language' })
    const languages = new Set(voices.map((voice) => voice.language))
    if (effectiveSpeechLanguage) languages.add(effectiveSpeechLanguage)
    return [
      { value: EMPTY_VALUE, label: t('settings.voice.unconfigured') },
      ...Array.from(languages)
        .map((language) => {
          let label = language
          try {
            label = displayNames.of(language) ?? language
          } catch {
            // Keep a previously entered locale visible even when it is invalid.
          }
          return { value: language, label, disabled: !voices.some((voice) => voice.language === language) }
        })
        .sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    ]
  }, [effectiveSpeechLanguage, i18n.language, t, voices])
  const speechVoiceOptions: ComboboxOption[] = [
    { value: EMPTY_VALUE, label: t('settings.voice.unconfigured') },
    ...voices
      .filter((voice) => voice.language === effectiveSpeechLanguage)
      .map((voice) => ({ value: voice.id, label: voice.name }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language))
  ]
  if (speechVoice && !selectedVoice) {
    speechVoiceOptions.push({
      value: speechVoice,
      label: t('settings.voice.status.voice_unavailable'),
      disabled: true
    })
  }
  const recognitionLanguageOptions = useMemo<ComboboxOption[]>(() => {
    if (!asrLocales) return []
    const displayNames = new Intl.DisplayNames([i18n.language], { type: 'language' })
    const label = (tag: string) => {
      try {
        return `${displayNames.of(tag) ?? tag} (${tag})`
      } catch {
        return tag
      }
    }
    const installed = new Set(asrLocales.installed)
    const options: ComboboxOption[] = [...asrLocales.supported]
      .sort((a, b) => Number(installed.has(b)) - Number(installed.has(a)) || a.localeCompare(b))
      .map((tag) => ({
        value: tag,
        label:
          tag === DEFAULT_APPLE_ASR_LOCALE && !languageValue(recognitionLanguage)
            ? `${label(tag)} · ${t('common.default')}`
            : label(tag),
        description: t(installed.has(tag) ? 'settings.voice.status.ready' : 'settings.voice.status.not_installed')
      }))
    if (!asrLocales.supported.includes(effectiveRecognitionLanguage)) {
      options.push({
        value: effectiveRecognitionLanguage,
        label: label(effectiveRecognitionLanguage),
        description: t('settings.voice.status.unsupported'),
        disabled: true
      })
    }
    return options
  }, [asrLocales, effectiveRecognitionLanguage, i18n.language, recognitionLanguage, t])
  const recognitionStatus =
    hasConfiguredRecognitionModel && !configuredRecognitionModel
      ? ({ status: 'unsupported', reason: 'unsupported' } satisfies StatusState)
      : !effectiveRecognitionModel
        ? ({ status: 'unconfigured' } satisfies StatusState)
        : funAsrSelected
          ? funAsrStatusState(funAsrModel)
          : queriedRecognitionStatus?.modelId === effectiveRecognitionModel &&
              queriedRecognitionStatus.language === effectiveRecognitionLanguage
            ? queriedRecognitionStatus.result
            : ({ status: 'unconfigured' } satisfies StatusState)
  const funAsrAction: FunAsrAction | undefined =
    !funAsrSelected || !funAsrModel.isStatusResolved
      ? undefined
      : funAsrModel.status === 'not_downloaded' || funAsrModel.status === 'error'
        ? 'download'
        : funAsrModel.status === 'downloading'
          ? 'cancel'
          : funAsrModel.status === 'ready'
            ? 'remove'
            : undefined

  useEffect(() => {
    if (
      (hasConfiguredRecognitionModel && !configuredRecognitionModel) ||
      !effectiveRecognitionModel ||
      effectiveRecognitionModel === FUNASR_MODEL_ID
    )
      return
    let current = true
    const query = { modelId: effectiveRecognitionModel, language: effectiveRecognitionLanguage }
    void voiceService
      .getModelStatus(query)
      .then((status) => {
        if (current) setQueriedRecognitionStatus({ ...query, result: status })
      })
      .catch(() => {
        if (current) setQueriedRecognitionStatus({ ...query, result: { status: 'failed', reason: 'operation_failed' } })
      })
    return () => {
      current = false
    }
  }, [
    configuredRecognitionModel,
    effectiveRecognitionLanguage,
    effectiveRecognitionModel,
    hasConfiguredRecognitionModel
  ])

  useEffect(() => {
    if (!speechModel) {
      setSpeechStatus({ status: 'unconfigured' })
      return
    }
    let current = true
    void voiceService
      .getModelStatus({
        modelId: speechModel as LocalVoiceModelId,
        ...(languageValue(speechLanguage) && { language: languageValue(speechLanguage) }),
        ...(optionalValue(speechVoice) && { voice: optionalValue(speechVoice) })
      })
      .then((status) => {
        if (current) setSpeechStatus(status)
      })
      .catch(() => {
        if (current) setSpeechStatus({ status: 'failed', reason: 'operation_failed' })
      })
    return () => {
      current = false
    }
  }, [speechLanguage, speechModel, speechVoice])

  useEffect(() => {
    if (dictation.error !== 'microphone_permission') return
    let current = true
    let refreshPending = false

    const refreshMicrophoneStatus = () => {
      if (refreshPending) return
      refreshPending = true
      const run = dictationRunRef.current
      void voiceService
        .getMicrophoneStatus()
        .then(async (status) => {
          if (!current) return
          setMicrophoneStatus(status)
          if (status !== 'granted') return
          await run?.cancel()
          if (current && dictationRunRef.current === run) dictationRunRef.current = undefined
        })
        .catch(() => {
          if (current) setActionFailed(true)
        })
        .finally(() => {
          refreshPending = false
        })
    }

    refreshMicrophoneStatus()
    window.addEventListener('focus', refreshMicrophoneStatus)
    return () => {
      current = false
      window.removeEventListener('focus', refreshMicrophoneStatus)
    }
  }, [dictation.error])

  useEffect(
    () =>
      voiceTargetManager.bind({
        targetId: 'voice-settings-transcription-test',
        owner: window,
        sourceEntityId: 'voice-settings',
        captureReplaceRange: () => (transcriptRef.current ? { from: 0, to: transcriptValueRef.current.length } : null),
        replaceRange: (_range, text) => {
          setTranscript(text)
          return true
        }
      }),
    []
  )

  const transcriptionModels = models.filter((model) => model.id === APPLE_ASR_MODEL_ID || model.id === FUNASR_MODEL_ID)
  const speechModels = models.filter((model) => model.id === APPLE_TTS_MODEL_ID)
  const canInstallApple =
    effectiveRecognitionModel === APPLE_ASR_MODEL_ID &&
    recognitionStatus.status === 'not_installed' &&
    recognitionStatus.reason === 'asset_required'
  const dictationRecording = dictation.phase === 'starting' || dictation.phase === 'recording'
  const dictationProcessing = dictation.phase === 'stopping' || dictation.phase === 'transcribing'
  const dictationHasPendingResult = dictation.recoveryAvailable || dictation.retryAvailable === true
  const microphonePermissionFailed = dictation.error === 'microphone_permission'
  const microphoneBlocked =
    microphonePermissionFailed ||
    microphoneStatus === 'unknown' ||
    microphoneStatus === 'denied' ||
    microphoneStatus === 'restricted'
  const canOpenMicrophoneSettings = microphoneStatus === 'denied' || microphoneStatus === 'restricted'
  const speechBusy = ['generating', 'playing', 'paused'].includes(speech.phase)

  const savePreference = (write: () => Promise<void>) => {
    setActionFailed(false)
    try {
      void write().catch(() => setActionFailed(true))
    } catch {
      setActionFailed(true)
    }
  }

  const installAppleAsset = async () => {
    if (!canInstallApple) return
    const previousStatus = recognitionStatus
    const query = { modelId: APPLE_ASR_MODEL_ID, language: effectiveRecognitionLanguage }
    setInstalling(true)
    setQueriedRecognitionStatus({ ...query, result: { status: 'installing', reason: 'asset_required' } })
    setActionFailed(false)
    try {
      await voiceService.installTranscriptionAsset({ language: effectiveRecognitionLanguage, source: 'settings' })
        .result
      setQueriedRecognitionStatus({ ...query, result: await voiceService.getModelStatus(query) })
      const locales = await voiceService.listTranscriptionLocales().catch(() => undefined)
      if (locales) setAsrLocales(locales)
    } catch {
      setQueriedRecognitionStatus({ ...query, result: previousStatus })
      setActionFailed(true)
    } finally {
      setInstalling(false)
    }
  }

  const runFunAsrAction = async (
    actionName: FunAsrAction,
    action: () => Promise<unknown>,
    failureReason: VoiceErrorReason
  ) => {
    setPendingFunAsrAction(actionName)
    setActionFailed(false)
    try {
      await action()
    } catch {
      setActionFailed(failureReason)
    } finally {
      setPendingFunAsrAction((current) => (current === actionName ? undefined : current))
    }
  }

  const toggleDictation = () => {
    setActionFailed(false)
    if (dictationRecording) {
      void dictationService.stop().catch(() => setActionFailed(true))
      return
    }
    setTranscript('')
    voiceTargetManager.markCurrent('voice-settings-transcription-test')
    const run = dictationService.startScoped()
    dictationRunRef.current = run
    void run.result.catch(() => {
      if (dictationRunRef.current === run) setActionFailed(true)
    })
  }

  const togglePreview = () => {
    setActionFailed(false)
    if (speechBusy) {
      void speechPlaybackService.stop().catch(() => setActionFailed(true))
      return
    }
    void speechPlaybackService
      .start({
        text: previewText,
        trigger: 'manual',
        sourceLabel: 'preview',
        sourceEntityId: 'voice-settings'
      })
      .catch(() => setActionFailed(true))
  }

  const updateAutoRead = async (enabled: boolean) => {
    setActionFailed(false)
    try {
      if (!enabled) {
        await setAutoRead(false)
        return
      }
      if (!disclosureConfirmed) {
        const confirmed = await popup.confirm({
          title: t('settings.voice.auto_read.disclosure.title'),
          content: t('settings.voice.auto_read.disclosure.content'),
          okText: t('common.confirm'),
          cancelText: t('common.cancel'),
          centered: true,
          focusOnClose: () => autoReadRef.current?.focus()
        })
        if (!confirmed) return
        await setDisclosureConfirmed(true)
      }
      await setAutoRead(true)
    } catch {
      setActionFailed(true)
    }
  }

  const error = actionFailed || dictation.error || speech.error

  return (
    <SettingsContentColumn theme={theme}>
      <h1 className="text-xl font-semibold text-foreground">{t('settings.voice.title')}</h1>
      <SettingDescription>{t('settings.voice.description')}</SettingDescription>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.voice.recognition.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-voice-recognition-model" className="scroll-mt-6">
          <div>
            <SettingRowTitle>{t('settings.voice.recognition.model')}</SettingRowTitle>
            {funAsrSelected ? (
              <SettingDescription className="mt-1">{t('settings.voice.model.funasr_details')}</SettingDescription>
            ) : null}
          </div>
          <Select
            value={recognitionModel || EMPTY_VALUE}
            onValueChange={(value) =>
              savePreference(async () => {
                const modelId = value === EMPTY_VALUE ? '' : value
                await setRecognitionPreferences({
                  modelId,
                  ...(modelId === FUNASR_MODEL_ID && { language: '' })
                })
              })
            }>
            <SelectTrigger className="w-64" aria-label={t('settings.voice.recognition.model')}>
              <SelectValue placeholder={t('settings.voice.unconfigured')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_VALUE}>{t('settings.voice.unconfigured')}</SelectItem>
              {transcriptionModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {t(MODEL_LABEL_KEYS[model.id])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-recognition-language" className="scroll-mt-6">
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Combobox
            className="w-64"
            aria-label={t('settings.voice.recognition.language')}
            options={
              funAsrSelected
                ? [{ value: 'auto', label: t('settings.voice.language.auto_detect') }]
                : recognitionLanguageOptions
            }
            value={funAsrSelected ? 'auto' : effectiveRecognitionLanguage}
            disabled={funAsrSelected || effectiveRecognitionModel !== APPLE_ASR_MODEL_ID || !asrLocales || installing}
            onChange={(value) => {
              if (typeof value === 'string') savePreference(() => setRecognitionPreferences({ language: value }))
            }}
            placeholder={t('common.select')}
            searchPlaceholder={t('common.search')}
            emptyText={t('common.no_results')}
            searchPlacement="trigger"
            popoverClassName="w-(--radix-popover-trigger-width)"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-recognition-status" className="scroll-mt-6">
          <div>
            <SettingRowTitle>{t('settings.voice.status.label')}</SettingRowTitle>
            <SettingDescription className="mt-1">
              {funAsrSelected && funAsrModel.status === 'downloading'
                ? t('settings.voice.status.downloading_percent', { percent: funAsrModel.percent })
                : t(statusKey(recognitionStatus))}
            </SettingDescription>
          </div>
          {canInstallApple ? (
            <Button disabled={installing} onClick={() => void installAppleAsset()}>
              <Download className="size-4" />
              {t('settings.voice.action.install')}
            </Button>
          ) : null}
          {funAsrAction ? (
            <Button
              variant={funAsrAction === 'download' ? undefined : 'outline'}
              disabled={
                pendingFunAsrAction !== undefined && !(pendingFunAsrAction === 'download' && funAsrAction === 'cancel')
              }
              onClick={() => {
                if (funAsrAction === 'download') {
                  void runFunAsrAction('download', funAsrModel.download, 'download_failed')
                } else if (funAsrAction === 'cancel') {
                  void runFunAsrAction('cancel', funAsrModel.cancel, 'operation_failed')
                } else {
                  void runFunAsrAction('remove', funAsrModel.remove, 'operation_failed')
                }
              }}>
              {funAsrAction === 'cancel' ? (
                <X className="size-4" />
              ) : funAsrAction === 'remove' ? (
                <Trash2 className="size-4" />
              ) : (
                <Download className="size-4" />
              )}
              {t(
                funAsrAction === 'cancel'
                  ? 'settings.voice.action.cancel_download'
                  : funAsrAction === 'remove'
                    ? 'settings.voice.action.remove_model'
                    : funAsrModel.status === 'error'
                      ? 'settings.voice.action.retry_download'
                      : 'settings.voice.action.download_model'
              )}
            </Button>
          ) : null}
        </SettingRow>
        {canOpenMicrophoneSettings ? (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.voice.microphone.denied')}</SettingRowTitle>
              <Button
                variant="outline"
                onClick={() => {
                  setActionFailed(false)
                  void voiceService.openMicrophoneSettings().catch(() => setActionFailed(true))
                }}>
                {t('settings.voice.microphone.open_settings')}
              </Button>
            </SettingRow>
          </>
        ) : null}
        <SettingDivider />
        <div id="setting-voice-recognition-test" className="scroll-mt-6 space-y-3">
          <Textarea.Input
            ref={transcriptRef}
            aria-label={t('settings.voice.recognition.transcript')}
            value={transcript}
            onValueChange={setTranscript}
            onFocus={() => voiceTargetManager.markCurrent('voice-settings-transcription-test')}
            placeholder={t('settings.voice.recognition.transcript_placeholder')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={
                dictationProcessing ||
                dictationHasPendingResult ||
                microphoneBlocked ||
                !effectiveRecognitionModel ||
                (!dictationRecording && recognitionStatus.status !== 'ready')
              }
              onClick={toggleDictation}>
              {dictationRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
              {t(dictationRecording ? 'settings.voice.action.stop_recording' : 'settings.voice.action.record_test')}
            </Button>
            {dictation.retryAvailable ? (
              <Button
                variant="outline"
                onClick={() => void dictationService.retry().catch(() => setActionFailed(true))}>
                {t('settings.voice.action.retry')}
              </Button>
            ) : null}
            {dictation.recoveryAvailable ? (
              <>
                <Button variant="outline" onClick={() => dictationService.insertRecovery()}>
                  {t('settings.voice.action.insert_recovery')}
                </Button>
                <Button variant="outline" onClick={() => void dictationService.copyRecovery()}>
                  <Copy className="size-4" />
                  {t('common.copy')}
                </Button>
              </>
            ) : null}
            {dictationHasPendingResult ? (
              <Button
                variant="ghost"
                onClick={() => void dictationService.discard().catch(() => setActionFailed(true))}>
                {t('settings.voice.action.discard')}
              </Button>
            ) : null}
          </div>
          {dictation.phase !== 'idle' ? (
            <p
              role="status"
              aria-label={t('settings.voice.dictation.status_label')}
              className="text-xs text-muted-foreground">
              {t(DICTATION_PHASE_LABEL_KEYS[dictation.phase])}
              {dictation.elapsedMs > 0
                ? ` · ${t('settings.voice.dictation.elapsed', { seconds: Math.floor(dictation.elapsedMs / 1000) })}`
                : ''}
            </p>
          ) : null}
        </div>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.voice.speech.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-model" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.voice.speech.model')}</SettingRowTitle>
          <Select
            value={speechModel || EMPTY_VALUE}
            onValueChange={(value) => savePreference(() => setSpeechModel(value === EMPTY_VALUE ? '' : value))}>
            <SelectTrigger className="w-64" aria-label={t('settings.voice.speech.model')}>
              <SelectValue placeholder={t('settings.voice.unconfigured')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_VALUE}>{t('settings.voice.unconfigured')}</SelectItem>
              {speechModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {t(MODEL_LABEL_KEYS[model.id])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-language" className="scroll-mt-6">
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Combobox
            className="w-64"
            aria-label={t('settings.voice.speech.language')}
            options={speechLanguageOptions}
            value={effectiveSpeechLanguage || EMPTY_VALUE}
            onChange={(value) => {
              if (typeof value !== 'string') return
              const language = value === EMPTY_VALUE ? '' : value
              savePreference(() =>
                setSpeechPreferences({
                  language,
                  voiceId: selectedVoice?.language === language ? selectedVoice.id : ''
                })
              )
            }}
            placeholder={t('common.select')}
            searchPlaceholder={t('common.search')}
            emptyText={t('common.no_results')}
            searchPlacement="trigger"
            popoverClassName="w-(--radix-popover-trigger-width)"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-voice" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.voice.speech.voice')}</SettingRowTitle>
          <Combobox
            className="w-64"
            aria-label={t('settings.voice.speech.voice')}
            options={speechVoiceOptions}
            value={speechVoice || EMPTY_VALUE}
            disabled={!effectiveSpeechLanguage}
            onChange={(value) => {
              if (typeof value !== 'string') return
              savePreference(() =>
                setSpeechPreferences({ voiceId: value === EMPTY_VALUE ? '' : value, language: effectiveSpeechLanguage })
              )
            }}
            placeholder={t('common.select')}
            searchPlaceholder={t('common.search')}
            emptyText={t('common.no_results')}
            searchPlacement="trigger"
            popoverClassName="w-(--radix-popover-trigger-width)"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-speed" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.voice.speech.speed')}</SettingRowTitle>
          <InputNumber
            className="w-24"
            aria-label={t('settings.voice.speech.speed')}
            min={0.5}
            max={2}
            step={0.1}
            value={speechSpeed}
            onBlur={(value) => savePreference(() => setSpeechSpeed(value ?? 1))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-status" className="scroll-mt-6">
          <div>
            <SettingRowTitle>{t('settings.voice.status.label')}</SettingRowTitle>
            <SettingDescription data-testid="speech-status" className="mt-1">
              {t(statusKey(speechStatus))}
            </SettingDescription>
          </div>
        </SettingRow>
        <SettingDivider />
        <div id="setting-voice-speech-test" className="scroll-mt-6 space-y-3">
          <Textarea.Input
            aria-label={t('settings.voice.speech.preview_text')}
            value={previewText}
            maxLength={5000}
            onValueChange={setPreviewText}
            placeholder={t('settings.voice.speech.preview_placeholder')}
          />
          <Button
            disabled={
              !speechBusy && (!speechModel || !speechVoice || !previewText.trim() || speechStatus.status !== 'ready')
            }
            onClick={togglePreview}>
            {speechBusy ? <Square className="size-4" /> : <Play className="size-4" />}
            {t(speechBusy ? 'common.stop' : 'settings.voice.action.play_preview')}
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.voice.auto_read.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-voice-auto-read" className="scroll-mt-6">
          <div>
            <SettingRowTitle>{t('settings.voice.auto_read.label')}</SettingRowTitle>
            <SettingDescription>{t('settings.voice.auto_read.description')}</SettingDescription>
          </div>
          <Switch
            ref={autoReadRef}
            aria-label={t('settings.voice.auto_read.label')}
            checked={autoRead}
            onCheckedChange={(enabled) => void updateAutoRead(enabled)}
          />
        </SettingRow>
      </SettingGroup>

      {error ? (
        <p role="alert" className="mt-4 text-destructive text-sm">
          {t(errorKey(error))}
        </p>
      ) : null}
    </SettingsContentColumn>
  )
}

export default VoiceSettings
