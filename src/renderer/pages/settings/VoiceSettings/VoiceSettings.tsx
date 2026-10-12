import { Link } from '@tanstack/react-router'
import { Copy, Mic, Play, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
import { useTheme } from '@renderer/hooks/useTheme'
import { popup } from '@renderer/services/popup'
import {
  dictationService,
  enumerateMicrophones,
  subscribeMicrophoneChanges,
  type MicrophoneDevice,
  type DictationPhase,
  getDefaultVoiceLanguage,
  speechPlaybackService,
  type SpeechPlaybackSnapshot,
  VoiceDomainError,
  voiceService,
  voiceTargetManager
} from '@renderer/services/voice'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID,
  type LocalSpeechModelId,
  type LocalVoiceModelDescriptor,
  isTranscriptionModelId,
  isSpeechModelId,
  TranscriptionLanguageSource,
  VoiceResourceOperation,
  type LocalVoiceModelId,
  type LocalTranscriptionModelId
} from '@shared/ai/localVoice'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

type ModelStatus = 'unsupported' | 'not_installed' | 'installing' | 'ready' | 'failed' | 'loading'

interface StatusState {
  status: ModelStatus
  reason?: VoiceErrorReason
  percent?: number
}

interface QueriedRecognitionStatus {
  modelId: LocalTranscriptionModelId
  language: string
  result: StatusState
}

interface QueriedSpeechStatus {
  modelId: LocalSpeechModelId
  language?: string
  voice?: string
  result: StatusState
}

interface VoiceSelectOption {
  value: string
  label: string
  disabled?: boolean
}

const EMPTY_VALUE = '__automatic__'
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
  [FUNASR_MODEL_ID]: 'settings.voice.model.funasr',
  [WINDOWS_ASR_MODEL_ID]: 'settings.voice.model.windows_asr',
  [WINDOWS_TTS_MODEL_ID]: 'settings.voice.model.windows_tts'
}
const DICTATION_PHASE_LABEL_KEYS: Record<Exclude<DictationPhase, 'idle'>, string> = {
  failed: 'settings.voice.dictation.phase.failed',
  recorded: 'settings.voice.dictation.phase.recorded',
  recording: 'settings.voice.dictation.phase.recording',
  recovery: 'settings.voice.dictation.phase.recovery',
  starting: 'settings.voice.dictation.phase.starting',
  stopping: 'settings.voice.dictation.phase.stopping',
  transcribing: 'settings.voice.dictation.phase.transcribing'
}

function statusKey(status: StatusState): string {
  if (status.status === 'loading') return 'common.loading'
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
    [
      'download_failed',
      'model_load_failed',
      'no_speech',
      'worker_crashed',
      'timeout',
      'microphone_permission',
      'microphone_unavailable',
      'microphone_unreadable',
      'recording_failed'
    ].includes(error)
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

function languageLabel(language: string, displayNames: Intl.DisplayNames, worldLabel: string): string {
  try {
    const label = displayNames.of(language) ?? language
    // Electron may leave the world-region code untranslated.
    return new Intl.Locale(language).region === '001' ? label.replace('001', worldLabel) : label
  } catch {
    return language
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
  const [microphoneDeviceId, setMicrophoneDeviceId] = usePreference('feature.voice.input.device_id')
  const [microphones, setMicrophones] = useState<readonly MicrophoneDevice[]>([])
  const [microphonesFailed, setMicrophonesFailed] = useState(false)
  const [testingMicrophone, setTestingMicrophone] = useState(false)
  const [microphoneReady, setMicrophoneReady] = useState(false)
  const [microphoneLevel, setMicrophoneLevel] = useState(0)
  const [microphoneError, setMicrophoneError] = useState<VoiceErrorReason>()
  const microphoneQueryGeneration = useRef(0)
  const microphoneAuthorization = useRef<AbortController | null>(null)
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
  const [models, setModels] = useState<readonly LocalVoiceModelDescriptor[]>([])
  const [asrLocales, setAsrLocales] = useState<Awaited<ReturnType<typeof voiceService.listTranscriptionLocales>>>()
  const [defaultAsrModel, setDefaultAsrModel] = useState<LocalTranscriptionModelId>()
  const [defaultSpeechModel, setDefaultSpeechModel] = useState<LocalSpeechModelId>()
  const [recommendedVoice, setRecommendedVoice] = useState<string>()
  const [voices, setVoices] = useState<readonly { id: string; name: string; language: string }[]>([])
  const [queriedRecognitionStatus, setQueriedRecognitionStatus] = useState<QueriedRecognitionStatus>()
  const [queriedSpeechStatus, setQueriedSpeechStatus] = useState<QueriedSpeechStatus>()
  const [microphoneStatus, setMicrophoneStatus] =
    useState<Awaited<ReturnType<typeof voiceService.getMicrophoneStatus>>>()
  const [actionFailed, setActionFailed] = useState<boolean | VoiceErrorReason>(false)
  const [previewFailure, setPreviewFailure] = useState<{ snapshot: SpeechPlaybackSnapshot; reason: VoiceErrorReason }>()
  const [transcript, setTranscript] = useState('')
  const [previewText, setPreviewText] = useState('')
  const transcriptRef = useRef<HTMLTextAreaElement>(null)
  const transcriptValueRef = useRef('')
  const autoReadRef = useRef<HTMLButtonElement>(null)
  const dictationRunRef = useRef<ReturnType<typeof dictationService.startScoped> | undefined>(undefined)
  const previewGenerationRef = useRef(0)
  const speechStatusCheckRef = useRef<Promise<void>>(Promise.resolve())
  const loadedCatalogs = useRef(new Set<string>())
  const catalogAttempt = useRef(-1)
  const [queryRevision, setQueryRevision] = useState(0)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(true)

  transcriptValueRef.current = transcript

  useEffect(() => {
    let current = true
    if (catalogAttempt.current === queryRevision) loadedCatalogs.current.clear()
    catalogAttempt.current = queryRevision
    setCatalogLoading(true)
    const load = async (key: string, query: () => Promise<void>) => {
      if (loadedCatalogs.current.has(key)) return
      await query()
      if (current) loadedCatalogs.current.add(key)
    }
    void voiceService
      .initialize()
      .then(async () => {
        const results = await Promise.allSettled([
          load('models', async () => {
            const result = await voiceService.listModels()
            if (!current) return
            setModels(result.models)
            setDefaultAsrModel(result.defaultAsrModelId)
            setDefaultSpeechModel(result.defaultSpeechModelId)
          }),
          load('microphone', async () => {
            const result = await voiceService.getMicrophoneStatus()
            if (current) setMicrophoneStatus(result)
          })
        ])
        if (current) setCatalogFailed(results.some((result) => result.status === 'rejected'))
      })
      .catch(() => {
        if (current) setCatalogFailed(true)
      })
      .finally(() => {
        if (current) setCatalogLoading(false)
      })
    return () => {
      current = false
    }
  }, [queryRevision])

  const configuredRecognitionModel =
    recognitionModel && isTranscriptionModelId(recognitionModel) ? recognitionModel : undefined
  const hasConfiguredRecognitionModel = optionalValue(recognitionModel) !== undefined
  const effectiveRecognitionModel = hasConfiguredRecognitionModel ? configuredRecognitionModel : defaultAsrModel
  const recognitionDescriptor = models.find((model) => model.id === effectiveRecognitionModel)
  const automaticLanguage = recognitionDescriptor?.localeSelection === null
  const incompatibleLanguage = automaticLanguage ? languageValue(recognitionLanguage) : undefined
  const defaultLanguage = getDefaultVoiceLanguage(i18n.resolvedLanguage ?? i18n.language)
  const effectiveRecognitionLanguage = languageValue(recognitionLanguage) ?? defaultLanguage
  const selectedVoice = voices.find((voice) => voice.id === (speechVoice || recommendedVoice))
  const effectiveSpeechLanguage = languageValue(speechLanguage) ?? selectedVoice?.language ?? defaultLanguage
  const speechLanguageOptions = useMemo<VoiceSelectOption[]>(() => {
    const displayNames = new Intl.DisplayNames([i18n.language], { type: 'language', languageDisplay: 'standard' })
    const worldLabel = t('settings.voice.language.world')
    const languages = new Set(voices.map((voice) => voice.language))
    if (effectiveSpeechLanguage) languages.add(effectiveSpeechLanguage)
    return [
      {
        value: EMPTY_VALUE,
        label: t('settings.voice.language.follow_interface', {
          language: languageLabel(defaultLanguage, displayNames, worldLabel)
        })
      },
      ...Array.from(languages)
        .map((language) => ({
          value: language,
          label: languageLabel(language, displayNames, worldLabel),
          disabled: !voices.some((voice) => voice.language === language)
        }))
        .sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    ]
  }, [defaultLanguage, effectiveSpeechLanguage, i18n.language, t, voices])
  const speechVoiceOptions: VoiceSelectOption[] = [
    {
      value: EMPTY_VALUE,
      label: t('settings.voice.recommended', {
        name: voices.find((voice) => voice.id === recommendedVoice)?.name ?? t('common.loading')
      })
    },
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
  const recognitionLanguageOptions = useMemo<VoiceSelectOption[]>(() => {
    if (!asrLocales) return []
    const displayNames = new Intl.DisplayNames([i18n.language], { type: 'language', languageDisplay: 'standard' })
    const worldLabel = t('settings.voice.language.world')
    const label = (tag: string) => languageLabel(tag, displayNames, worldLabel)
    const options: VoiceSelectOption[] = asrLocales.supported.map((tag) => ({ value: tag, label: label(tag) }))
    if (!asrLocales.supported.includes(effectiveRecognitionLanguage)) {
      options.push({
        value: effectiveRecognitionLanguage,
        label: label(effectiveRecognitionLanguage),
        disabled: true
      })
    }
    return [
      {
        value: EMPTY_VALUE,
        label: t('settings.voice.language.follow_interface', { language: label(defaultLanguage) })
      },
      ...options.sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    ]
  }, [asrLocales, defaultLanguage, effectiveRecognitionLanguage, i18n.language, t])
  const recognitionStatus: StatusState =
    hasConfiguredRecognitionModel && !configuredRecognitionModel
      ? { status: 'unsupported', reason: 'unsupported' }
      : !effectiveRecognitionModel
        ? { status: catalogLoading ? 'loading' : 'unsupported' }
        : queriedRecognitionStatus?.modelId === effectiveRecognitionModel &&
            queriedRecognitionStatus.language === effectiveRecognitionLanguage
          ? queriedRecognitionStatus.result
          : { status: 'loading' }
  const configuredSpeechModel = speechModel
    ? isSpeechModelId(speechModel)
      ? speechModel
      : undefined
    : defaultSpeechModel
  const configuredSpeechLanguage = languageValue(speechLanguage)
  const configuredSpeechVoice = optionalValue(speechVoice)
  const speechStatus: StatusState =
    speechModel && !configuredSpeechModel
      ? { status: 'unsupported', reason: 'unsupported' }
      : configuredSpeechModel &&
          queriedSpeechStatus?.modelId === configuredSpeechModel &&
          queriedSpeechStatus.language === configuredSpeechLanguage &&
          queriedSpeechStatus.voice === configuredSpeechVoice
        ? queriedSpeechStatus.result
        : { status: !configuredSpeechModel && !catalogLoading ? 'unsupported' : 'loading' }

  useEffect(() => {
    if (hasConfiguredRecognitionModel && !configuredRecognitionModel) return
    let current = true
    setQueriedRecognitionStatus(undefined)
    void voiceService
      .resolveTranscriptionConfiguration({
        modelId: configuredRecognitionModel,
        language: {
          source: languageValue(recognitionLanguage)
            ? TranscriptionLanguageSource.Explicit
            : TranscriptionLanguageSource.Interface,
          locale: effectiveRecognitionLanguage
        }
      })
      .then((resolved) => {
        if (!current) return
        if (!hasConfiguredRecognitionModel) setDefaultAsrModel(resolved.modelId)
        if (resolved.modelId)
          setQueriedRecognitionStatus({
            modelId: resolved.modelId,
            language: effectiveRecognitionLanguage,
            result: resolved.status
          })
      })
      .catch(() => {
        if (current) setCatalogFailed(true)
      })
    return () => {
      current = false
    }
  }, [
    configuredRecognitionModel,
    hasConfiguredRecognitionModel,
    recognitionLanguage,
    effectiveRecognitionLanguage,
    queryRevision
  ])

  useEffect(() => {
    setQueriedSpeechStatus(undefined)
    setRecommendedVoice(undefined)
    if (!configuredSpeechModel) return
    let current = true
    const query = { modelId: configuredSpeechModel, language: configuredSpeechLanguage, voice: configuredSpeechVoice }
    speechStatusCheckRef.current = speechStatusCheckRef.current.then(async () => {
      if (!current) return
      try {
        const resolved = await voiceService.resolveSpeechConfiguration({
          ...query,
          language: configuredSpeechLanguage ?? (configuredSpeechVoice ? undefined : defaultLanguage),
          speed: speechSpeed
        })
        if (current) {
          setRecommendedVoice(resolved.voice)
          setQueriedSpeechStatus({ ...query, result: resolved.status })
        }
      } catch {
        if (current) setQueriedSpeechStatus({ ...query, result: { status: 'failed', reason: 'operation_failed' } })
      }
    })
    return () => {
      current = false
    }
  }, [
    configuredSpeechLanguage,
    configuredSpeechModel,
    configuredSpeechVoice,
    defaultLanguage,
    speechSpeed,
    queryRevision
  ])

  useEffect(() => {
    let current = true
    setAsrLocales(undefined)
    if (effectiveRecognitionModel && recognitionDescriptor?.localeSelection) {
      void voiceService
        .listTranscriptionLocales(effectiveRecognitionModel)
        .then((result) => {
          if (current) setAsrLocales(result)
        })
        .catch(() => {
          if (current) setCatalogFailed(true)
        })
    }
    return () => {
      current = false
    }
  }, [effectiveRecognitionModel, recognitionDescriptor, queryRevision])

  useEffect(() => {
    let current = true
    setVoices([])
    if (configuredSpeechModel && models.some((model) => model.id === configuredSpeechModel)) {
      void voiceService
        .listVoices(configuredSpeechModel)
        .then((result) => {
          if (current) setVoices(result)
        })
        .catch(() => {
          if (current) setCatalogFailed(true)
        })
    }
    return () => {
      current = false
    }
  }, [configuredSpeechModel, models, queryRevision])

  useEffect(() => {
    let disposed = false
    const refresh = () => {
      const query = ++microphoneQueryGeneration.current
      void enumerateMicrophones()
        .then((devices) => {
          if (disposed || query !== microphoneQueryGeneration.current) return
          setMicrophones(devices)
          setMicrophonesFailed(false)
        })
        .catch(() => {
          if (!disposed && query === microphoneQueryGeneration.current) setMicrophonesFailed(true)
        })
    }
    refresh()
    const unsubscribe = subscribeMicrophoneChanges(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      unsubscribe()
      window.removeEventListener('focus', refresh)
    }
  }, [queryRevision])

  useEffect(
    () => () => {
      microphoneAuthorization.current?.abort()
      void dictationRunRef.current?.cancel()
      ++previewGenerationRef.current
    },
    []
  )

  const toggleMicrophoneTest = async () => {
    if (microphoneAuthorization.current) {
      microphoneAuthorization.current.abort()
      return
    }
    const controller = new AbortController()
    microphoneAuthorization.current = controller
    setTestingMicrophone(true)
    setMicrophoneReady(false)
    setMicrophoneError(undefined)
    try {
      await voiceService.testMicrophone(
        controller.signal,
        microphoneDeviceId,
        (devices) => {
          if (controller.signal.aborted) return
          ++microphoneQueryGeneration.current
          setMicrophones(devices)
          setMicrophonesFailed(false)
          setMicrophoneReady(true)
          setMicrophoneStatus('granted')
        },
        setMicrophoneLevel
      )
    } catch (error) {
      if (!controller.signal.aborted)
        setMicrophoneError(error instanceof VoiceDomainError ? error.reason : 'recording_failed')
    } finally {
      if (microphoneAuthorization.current === controller) {
        microphoneAuthorization.current = null
        setTestingMicrophone(false)
        setMicrophoneLevel(0)
      }
    }
  }

  const microphonePermissionFailed =
    dictation.error === 'microphone_permission' || microphoneError === 'microphone_permission'
  const needsMicrophoneRecovery =
    microphonePermissionFailed || microphoneStatus === 'denied' || microphoneStatus === 'restricted'

  useEffect(() => {
    if (!needsMicrophoneRecovery) return
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
          setMicrophoneError(undefined)
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

    if (microphonePermissionFailed) refreshMicrophoneStatus()
    window.addEventListener('focus', refreshMicrophoneStatus)
    return () => {
      current = false
      window.removeEventListener('focus', refreshMicrophoneStatus)
    }
  }, [microphonePermissionFailed, needsMicrophoneRecovery])

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

  const transcriptionModels = models.filter((model) => isTranscriptionModelId(model.id))
  const speechModels = models.filter((model) => isSpeechModelId(model.id))
  const dictationRecording = dictation.phase === 'starting' || dictation.phase === 'recording'
  const dictationProcessing = dictation.phase === 'stopping' || dictation.phase === 'transcribing'
  const dictationHasPendingResult =
    dictation.phase === 'recorded' || dictation.recoveryAvailable || dictation.retryAvailable === true
  const microphoneBlocked =
    microphonePermissionFailed ||
    microphoneStatus === undefined ||
    microphoneStatus === 'denied' ||
    microphoneStatus === 'restricted'
  const canOpenMicrophoneSettings = needsMicrophoneRecovery
  const speechBusy = ['generating', 'playing', 'paused'].includes(speech.phase)
  const speechError = previewFailure?.snapshot === speech ? previewFailure.reason : speech.error

  const savePreference = (write: () => Promise<void>) => {
    setActionFailed(false)
    try {
      void write().catch(() => setActionFailed(true))
    } catch {
      setActionFailed(true)
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
    const generation = ++previewGenerationRef.current
    setActionFailed(false)
    setPreviewFailure(undefined)
    const reportFailure = (error: unknown) => {
      if (generation !== previewGenerationRef.current) return
      const reason = error instanceof VoiceDomainError ? error.reason : 'operation_failed'
      if (reason === 'aborted') return
      setPreviewFailure({ snapshot: speechPlaybackService.getSnapshot(), reason })
    }
    if (speechBusy) {
      void speechPlaybackService.stop().catch(reportFailure)
      return
    }
    void speechPlaybackService
      .start({
        text: previewText.trim() || i18n.getFixedT(effectiveSpeechLanguage)('settings.voice.speech.sample'),
        trigger: 'manual',
        sourceLabel: 'preview',
        sourceEntityId: 'voice-settings'
      })
      .catch(reportFailure)
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

  return (
    <SettingsContentColumn theme={theme} className="[&_[data-slot=select-trigger]]:max-w-full">
      {catalogFailed || recognitionStatus.status === 'failed' || speechStatus.status === 'failed' ? (
        <div className="flex items-center gap-2">
          <SettingDescription>{t('settings.voice.status.operation_failed')}</SettingDescription>
          <Button
            variant="outline"
            disabled={catalogLoading}
            onClick={() => setQueryRevision((revision) => revision + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      <h1 className="text-xl font-semibold text-foreground">{t('settings.voice.title')}</h1>
      <SettingDescription>{t('settings.voice.description')}</SettingDescription>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.voice.recognition.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-voice-microphone" className="scroll-mt-6 flex-wrap gap-3">
          <SettingRowTitle>{t('settings.voice.microphone.label')}</SettingRowTitle>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-3">
            <Button variant="outline" size="lg" onClick={() => void toggleMicrophoneTest()}>
              {testingMicrophone ? <Square className="size-4" /> : <Mic className="size-4" />}
              {t(testingMicrophone ? 'settings.voice.microphone.stop_test' : 'settings.voice.microphone.test')}
            </Button>
            <Select
              disabled={testingMicrophone}
              value={microphoneDeviceId ?? EMPTY_VALUE}
              onValueChange={(value) =>
                savePreference(() => setMicrophoneDeviceId(value === EMPTY_VALUE ? null : value))
              }>
              <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.microphone.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_VALUE}>{t('settings.voice.microphone.system_default')}</SelectItem>
                {microphones.map((device, index) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label || t('settings.voice.microphone.unnamed', { number: index + 1 })}
                  </SelectItem>
                ))}
                {microphoneDeviceId && !microphones.some((device) => device.deviceId === microphoneDeviceId) ? (
                  <SelectItem value={microphoneDeviceId} disabled>
                    {t(
                      microphoneStatus === 'granted'
                        ? 'settings.voice.status.microphone_unavailable'
                        : 'settings.voice.microphone.permission_required'
                    )}
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </SettingRow>
        {testingMicrophone || microphoneError || microphonesFailed ? (
          <div className="space-y-3 pt-3">
            <div role="status" className="text-sm text-muted-foreground">
              {testingMicrophone
                ? t(microphoneReady ? 'settings.voice.microphone.listening' : 'settings.voice.dictation.phase.starting')
                : null}
            </div>
            {testingMicrophone && microphoneReady ? (
              <meter
                min={0}
                max={100}
                value={microphoneLevel}
                aria-label={t('settings.voice.microphone.level')}
                className="h-3 w-full accent-primary"
              />
            ) : null}
            {microphoneError || microphonesFailed ? (
              <p role="alert" className="text-sm text-destructive">
                {t(errorKey(microphoneError ?? 'operation_failed'))}
              </p>
            ) : null}
          </div>
        ) : null}
        <SettingDivider />
        <SettingRow id="setting-voice-recognition-model" className="scroll-mt-6 flex-wrap gap-3">
          <div>
            <SettingRowTitle>{t('settings.voice.recognition.model')}</SettingRowTitle>
          </div>
          <Select
            value={recognitionModel || EMPTY_VALUE}
            onValueChange={(value) =>
              savePreference(async () => {
                const modelId = value === EMPTY_VALUE ? '' : value
                await setRecognitionPreferences({
                  modelId,
                  ...(models.find((model) => model.id === modelId)?.localeSelection === null && { language: '' })
                })
              })
            }>
            <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.recognition.model')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_VALUE}>
                {t('settings.voice.automatic')}
                {!recognitionModel && effectiveRecognitionModel
                  ? ` · ${t(MODEL_LABEL_KEYS[effectiveRecognitionModel])}`
                  : ''}
              </SelectItem>
              {recognitionModel && !transcriptionModels.some((model) => model.id === recognitionModel) ? (
                <SelectItem value={recognitionModel} disabled>
                  {isTranscriptionModelId(recognitionModel) ? t(MODEL_LABEL_KEYS[recognitionModel]) : recognitionModel}{' '}
                  — {t('settings.voice.status.unsupported')}
                </SelectItem>
              ) : null}
              {transcriptionModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {t(MODEL_LABEL_KEYS[model.id])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-recognition-language" className="scroll-mt-6 flex-wrap gap-3">
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Select
            value={
              automaticLanguage ? (incompatibleLanguage ?? 'auto') : (languageValue(recognitionLanguage) ?? EMPTY_VALUE)
            }
            disabled={
              automaticLanguage ? !incompatibleLanguage : !recognitionDescriptor?.localeSelection || !asrLocales
            }
            onValueChange={(value) =>
              savePreference(() =>
                setRecognitionPreferences({ language: value === EMPTY_VALUE || value === 'auto' ? '' : value })
              )
            }>
            <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.recognition.language')}>
              <SelectValue placeholder={t('common.select')} />
            </SelectTrigger>
            <SelectContent>
              {automaticLanguage ? (
                <>
                  <SelectItem value="auto">{t('settings.voice.language.auto_detect')}</SelectItem>
                  {incompatibleLanguage ? (
                    <SelectItem value={incompatibleLanguage} disabled>
                      {incompatibleLanguage} — {t('settings.voice.status.unsupported')}
                    </SelectItem>
                  ) : null}
                </>
              ) : (
                recognitionLanguageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <div
          id="setting-voice-recognition-status"
          className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span role="status" className="text-muted-foreground">
            {t(statusKey(recognitionStatus))}
          </span>
          <Link
            to="/settings/local-models"
            hash={
              recognitionDescriptor?.resourceOperations.includes(VoiceResourceOperation.Download)
                ? 'voice-resources'
                : 'system-voice-resources'
            }
            className="text-link hover:underline">
            {t('settings.voice.manage_resources')}
          </Link>
        </div>
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
        <Accordion type="single" collapsible id="setting-voice-recognition-test" className="scroll-mt-6">
          <AccordionItem value="test">
            <AccordionTrigger>{t('settings.voice.recognition.test_details')}</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-3">
              <Textarea.Input
                ref={transcriptRef}
                aria-label={t('settings.voice.recognition.transcript')}
                aria-describedby={dictation.error ? 'voice-recognition-error' : undefined}
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
                    (!dictationRecording &&
                      (microphoneBlocked ||
                        !!incompatibleLanguage ||
                        !effectiveRecognitionModel ||
                        recognitionStatus.status !== 'ready'))
                  }
                  onClick={toggleDictation}>
                  {dictationRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
                  {t(dictationRecording ? 'settings.voice.action.stop_recording' : 'settings.voice.action.record_test')}
                </Button>
                {dictation.phase === 'recorded' ? (
                  <Button
                    variant="outline"
                    onClick={() => void dictationService.transcribeRecording().catch(() => setActionFailed(true))}>
                    {t('settings.voice.action.transcribe')}
                  </Button>
                ) : null}
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
              {dictation.phase !== 'idle' && !dictation.error ? (
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
              {dictation.error ? (
                <p id="voice-recognition-error" role="alert" className="text-sm text-error">
                  {t(errorKey(dictation.error))}
                </p>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.voice.speech.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-model" className="scroll-mt-6 flex-wrap gap-3">
          <SettingRowTitle>{t('settings.voice.speech.model')}</SettingRowTitle>
          {speechModels.length === 1 && (!speechModel || speechModel === speechModels[0].id) ? (
            <span className="text-sm text-muted-foreground">{t(MODEL_LABEL_KEYS[speechModels[0].id])}</span>
          ) : (
            <Select
              value={speechModel || EMPTY_VALUE}
              onValueChange={(value) => savePreference(() => setSpeechModel(value === EMPTY_VALUE ? '' : value))}>
              <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.speech.model')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_VALUE}>
                  {t('settings.voice.automatic')}
                  {!speechModel && configuredSpeechModel ? ` · ${t(MODEL_LABEL_KEYS[configuredSpeechModel])}` : ''}
                </SelectItem>
                {speechModel && !speechModels.some((model) => model.id === speechModel) ? (
                  <SelectItem value={speechModel} disabled>
                    {isSpeechModelId(speechModel) ? t(MODEL_LABEL_KEYS[speechModel]) : speechModel} —{' '}
                    {t('settings.voice.status.unsupported')}
                  </SelectItem>
                ) : null}
                {speechModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {t(MODEL_LABEL_KEYS[model.id])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-language" className="scroll-mt-6 flex-wrap gap-3">
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Select
            value={languageValue(speechLanguage) ?? (speechVoice ? selectedVoice?.language : undefined) ?? EMPTY_VALUE}
            onValueChange={(value) => {
              const language = value === EMPTY_VALUE ? '' : value
              savePreference(() =>
                setSpeechPreferences({
                  language,
                  voiceId:
                    speechVoice && selectedVoice?.language === (language || defaultLanguage) ? selectedVoice.id : ''
                })
              )
            }}>
            <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.speech.language')}>
              <SelectValue placeholder={t('common.select')} />
            </SelectTrigger>
            <SelectContent>
              {speechLanguageOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {effectiveSpeechLanguage ? (
          <>
            <SettingDivider />
            <SettingRow id="setting-voice-speech-voice" className="scroll-mt-6 flex-wrap gap-3">
              <SettingRowTitle>{t('settings.voice.speech.voice')}</SettingRowTitle>
              <Select
                value={speechVoice || EMPTY_VALUE}
                onValueChange={(value) => {
                  savePreference(() =>
                    setSpeechPreferences({
                      voiceId: value === EMPTY_VALUE ? '' : value,
                      language: effectiveSpeechLanguage
                    })
                  )
                }}>
                <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.speech.voice')}>
                  <SelectValue placeholder={t('common.select')} />
                </SelectTrigger>
                <SelectContent>
                  {speechVoiceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </>
        ) : null}
        <SettingDivider />
        <SettingRow id="setting-voice-speech-speed" className="scroll-mt-6 flex-wrap gap-3">
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
        <div
          id="setting-voice-speech-test"
          role="group"
          aria-label={t('settings.voice.action.play_preview')}
          className="scroll-mt-6 space-y-3">
          <div id="setting-voice-speech-status" className="flex flex-wrap items-center gap-3">
            <Button
              aria-describedby={speechError ? 'voice-speech-error' : undefined}
              disabled={!speechBusy && (!configuredSpeechModel || speechStatus.status !== 'ready')}
              onClick={togglePreview}>
              {speechBusy ? <Square className="size-4" /> : <Play className="size-4" />}
              {t(speechBusy ? 'common.stop' : 'settings.voice.action.play_preview')}
            </Button>
            <span role="status" data-testid="speech-status" className="text-sm text-muted-foreground">
              {t(statusKey(speechStatus))}
            </span>
            {speechStatus.status !== 'ready' ? (
              <Link
                to="/settings/local-models"
                hash="system-voice-resources"
                className="text-sm text-link hover:underline">
                {t('settings.voice.manage_resources')}
              </Link>
            ) : null}
          </div>
          <Accordion type="single" collapsible>
            <AccordionItem value="sample">
              <AccordionTrigger>{t('settings.voice.speech.custom_sample')}</AccordionTrigger>
              <AccordionContent className="pt-2">
                <Textarea.Input
                  aria-label={t('settings.voice.speech.preview_text')}
                  aria-describedby={speechError ? 'voice-speech-error' : undefined}
                  value={previewText}
                  maxLength={5000}
                  onValueChange={setPreviewText}
                  placeholder={t('settings.voice.speech.preview_placeholder')}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          {speechError ? (
            <p id="voice-speech-error" role="alert" className="text-sm text-error">
              {t(errorKey(speechError))}
            </p>
          ) : null}
        </div>
        <SettingDivider />
        <SettingRow id="setting-voice-auto-read" className="scroll-mt-6 flex-wrap gap-3">
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

      {actionFailed ? (
        <p role="alert" className="mt-4 text-destructive text-sm">
          {t(errorKey(actionFailed))}
        </p>
      ) : null}
    </SettingsContentColumn>
  )
}

export default VoiceSettings
