import { useNavigate } from '@tanstack/react-router'
import { Download, Mic, Play, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  InputNumber,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { useSharedCacheSelector } from '@data/hooks/useCache'
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
import { appLanguageOptions, isAppLanguage } from '@renderer/i18n/languages'
import { popup } from '@renderer/services/popup'
import {
  enumerateMicrophones,
  subscribeMicrophoneChanges,
  type MicrophoneDevice,
  getDefaultVoiceLanguage,
  speechPlaybackService,
  type SpeechPlaybackSnapshot,
  VoiceDomainError,
  voiceService
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
import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY, LOCAL_MODEL_STATUS_CACHE_KEY } from '@shared/data/presets/localModel'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'
import { defaultLanguage as fallbackSampleCatalog } from '@shared/utils/languages'

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
const INSTALL_LOCALE_PREFIX = '__install__:'
const SYSTEM_SETTINGS_VALUE = '__system_settings__'
const DOWNLOAD_MODEL_PREFIX = '__download_model__:'
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

function previewSampleCatalog(locale: string): string {
  if (isAppLanguage(locale)) return locale
  let language: string
  try {
    language = new Intl.Locale(locale).language
  } catch {
    return fallbackSampleCatalog
  }
  const catalogs = appLanguageOptions.filter((option) => new Intl.Locale(option.value).language === language)
  // zh-CN and zh-TW are distinct catalogs; only an unambiguous language may borrow one.
  return catalogs.length === 1 ? catalogs[0].value : fallbackSampleCatalog
}

function trackSettingsInspection(pending: Set<Promise<unknown>>, promise: Promise<unknown>) {
  pending.add(promise)
  void promise.finally(() => pending.delete(promise)).catch(() => undefined)
}

async function settleSettingsInspections(pending: Set<Promise<unknown>>) {
  while (pending.size > 0) await Promise.allSettled(Array.from(pending))
}

function VoiceSettings() {
  const { t, i18n } = useTranslation()
  const { theme } = useTheme()
  const navigate = useNavigate()
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
  const speech = useSyncExternalStore(
    speechPlaybackService.subscribe,
    speechPlaybackService.getSnapshot,
    speechPlaybackService.getSnapshot
  )
  const [models, setModels] = useState<readonly LocalVoiceModelDescriptor[]>([])
  const asrInstallationStatus = useSharedCacheSelector(
    [LOCAL_MODEL_STATUS_CACHE_KEY],
    ([snapshots]) => snapshots?.[LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr]?.status
  )
  const [downloadableModelStatuses, setDownloadableModelStatuses] = useState<
    Partial<Record<LocalTranscriptionModelId, StatusState>>
  >({})
  const [asrLocales, setAsrLocales] = useState<Awaited<ReturnType<typeof voiceService.listTranscriptionLocales>>>()
  const [defaultAsrModel, setDefaultAsrModel] = useState<LocalTranscriptionModelId>()
  const [defaultSpeechModel, setDefaultSpeechModel] = useState<LocalSpeechModelId>()
  const [defaultVoice, setDefaultVoice] =
    useState<Awaited<ReturnType<typeof voiceService.resolveSpeechConfiguration>>>()
  const [voices, setVoices] = useState<readonly { id: string; name: string; language: string }[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [queriedRecognitionStatus, setQueriedRecognitionStatus] = useState<QueriedRecognitionStatus>()
  const [queriedSpeechStatus, setQueriedSpeechStatus] = useState<QueriedSpeechStatus>()
  const [microphoneStatus, setMicrophoneStatus] =
    useState<Awaited<ReturnType<typeof voiceService.getMicrophoneStatus>>>()
  const [installingLocale, setInstallingLocale] = useState(false)
  const localeSelectionPending = useRef(false)
  const localeSelectionGeneration = useRef(0)
  const recognitionInspectionRef = useRef<Promise<void>>(Promise.resolve())
  const installingRecognitionLocaleRef = useRef(false)
  const pendingSettingsInspectionsRef = useRef(new Set<Promise<unknown>>())
  const [actionFailed, setActionFailed] = useState<boolean | VoiceErrorReason>(false)
  const [previewFailure, setPreviewFailure] = useState<{ snapshot: SpeechPlaybackSnapshot; reason: VoiceErrorReason }>()
  const autoReadRef = useRef<HTMLButtonElement>(null)
  const previewController = useRef<AbortController | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const speechStatusCheckRef = useRef<Promise<void>>(Promise.resolve())
  const loadedCatalogs = useRef(new Set<string>())
  const catalogAttempt = useRef(-1)
  const [queryRevision, setQueryRevision] = useState(0)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(true)

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

  useEffect(() => {
    if (installingRecognitionLocaleRef.current) return
    let current = true
    const downloadable = models.filter(
      (model) => isTranscriptionModelId(model.id) && model.resourceOperations.includes(VoiceResourceOperation.Download)
    )
    const inspection = Promise.all(
      downloadable.map((model) => {
        const status = voiceService.getModelStatus({ modelId: model.id })
        trackSettingsInspection(pendingSettingsInspectionsRef.current, status)
        return status.then((result) => [model.id, result] as const)
      })
    )
    void inspection
      .then((statuses) => {
        if (current) setDownloadableModelStatuses(Object.fromEntries(statuses))
      })
      .catch(() => {
        if (current) setCatalogFailed(true)
      })
    return () => {
      current = false
    }
  }, [models, queryRevision, asrInstallationStatus])

  const configuredRecognitionModel =
    recognitionModel && isTranscriptionModelId(recognitionModel) ? recognitionModel : undefined
  const hasConfiguredRecognitionModel = optionalValue(recognitionModel) !== undefined
  const effectiveRecognitionModel = hasConfiguredRecognitionModel ? configuredRecognitionModel : defaultAsrModel
  const recognitionDescriptor = models.find((model) => model.id === effectiveRecognitionModel)
  const automaticLanguage = recognitionDescriptor?.localeSelection === null
  const incompatibleLanguage = automaticLanguage ? languageValue(recognitionLanguage) : undefined
  const defaultLanguage = getDefaultVoiceLanguage(i18n.resolvedLanguage ?? i18n.language)
  const effectiveRecognitionLanguage = languageValue(recognitionLanguage) ?? defaultLanguage
  const selectedVoice = voices.find((voice) => voice.id === speechVoice)
  const effectiveSpeechLanguage = languageValue(speechLanguage) ?? selectedVoice?.language ?? defaultLanguage
  useLayoutEffect(() => {
    setPreviewLoading(false)
    return () => {
      previewController.current?.abort()
      previewController.current = null
    }
  }, [effectiveSpeechLanguage, speechModel, speechVoice, speechSpeed])

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
      label: t('settings.voice.speech.language_default', {
        name:
          defaultVoice?.status.status === 'ready'
            ? (voices.find((voice) => voice.id === defaultVoice.voice)?.name ??
              t(voicesLoading ? 'common.loading' : 'settings.voice.status.voice_unavailable'))
            : t(defaultVoice ? statusKey(defaultVoice.status) : 'common.loading')
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
    if (installingRecognitionLocaleRef.current) return
    let current = true
    const inspection = recognitionInspectionRef.current.then(async () => {
      if (!current || installingRecognitionLocaleRef.current) return
      setQueriedRecognitionStatus(undefined)
      try {
        const resolved = await voiceService.resolveTranscriptionConfiguration({
          modelId: configuredRecognitionModel,
          language: {
            source: languageValue(recognitionLanguage)
              ? TranscriptionLanguageSource.Explicit
              : TranscriptionLanguageSource.Interface,
            locale: effectiveRecognitionLanguage
          }
        })
        if (!current || installingRecognitionLocaleRef.current) return
        if (!hasConfiguredRecognitionModel) setDefaultAsrModel(resolved.modelId)
        if (resolved.modelId)
          setQueriedRecognitionStatus({
            modelId: resolved.modelId,
            language: effectiveRecognitionLanguage,
            result: resolved.status
          })
      } catch {
        if (current && !installingRecognitionLocaleRef.current) setCatalogFailed(true)
      }
    })
    recognitionInspectionRef.current = inspection
    trackSettingsInspection(pendingSettingsInspectionsRef.current, inspection)
    return () => {
      current = false
    }
  }, [
    configuredRecognitionModel,
    hasConfiguredRecognitionModel,
    recognitionLanguage,
    effectiveRecognitionLanguage,
    queryRevision,
    asrInstallationStatus
  ])

  useEffect(() => {
    if (installingRecognitionLocaleRef.current) return
    setQueriedSpeechStatus(undefined)
    setDefaultVoice(undefined)
    if (!configuredSpeechModel) return
    let current = true
    const query = { modelId: configuredSpeechModel, language: configuredSpeechLanguage, voice: configuredSpeechVoice }
    const inspection = speechStatusCheckRef.current.then(async () => {
      if (!current || installingRecognitionLocaleRef.current) return
      try {
        const resolved = await voiceService.resolveSpeechConfiguration({
          ...query,
          language: effectiveSpeechLanguage,
          speed: speechSpeed
        })
        if (current) {
          setQueriedSpeechStatus({ ...query, result: resolved.status })
          if (!configuredSpeechVoice) setDefaultVoice(resolved)
        }
        if (current && configuredSpeechVoice) {
          try {
            const automatic = await voiceService.resolveSpeechConfiguration({
              modelId: configuredSpeechModel,
              language: effectiveSpeechLanguage
            })
            if (current) setDefaultVoice(automatic)
          } catch {
            if (current) setDefaultVoice({ speed: 1, status: { status: 'failed', reason: 'operation_failed' } })
          }
        }
      } catch {
        if (current) {
          setQueriedSpeechStatus({ ...query, result: { status: 'failed', reason: 'operation_failed' } })
          setDefaultVoice({ speed: 1, status: { status: 'failed', reason: 'operation_failed' } })
        }
      }
    })
    speechStatusCheckRef.current = inspection
    trackSettingsInspection(pendingSettingsInspectionsRef.current, inspection)
    return () => {
      current = false
    }
  }, [
    configuredSpeechLanguage,
    configuredSpeechModel,
    configuredSpeechVoice,
    effectiveSpeechLanguage,
    speechSpeed,
    queryRevision
  ])

  useEffect(() => {
    if (installingRecognitionLocaleRef.current) return
    let current = true
    setAsrLocales(undefined)
    if (effectiveRecognitionModel && recognitionDescriptor?.localeSelection) {
      const inspection = voiceService.listTranscriptionLocales(effectiveRecognitionModel)
      trackSettingsInspection(pendingSettingsInspectionsRef.current, inspection)
      void inspection
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
    if (installingRecognitionLocaleRef.current) return
    let current = true
    setVoices([])
    setVoicesLoading(false)
    if (configuredSpeechModel && models.some((model) => model.id === configuredSpeechModel)) {
      setVoicesLoading(true)
      const inspection = voiceService.listVoices(configuredSpeechModel)
      trackSettingsInspection(pendingSettingsInspectionsRef.current, inspection)
      void inspection
        .then((result) => {
          if (current) setVoices(result)
        })
        .catch(() => {
          if (current) setCatalogFailed(true)
        })
        .finally(() => {
          if (current) setVoicesLoading(false)
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

  const microphonePermissionFailed = microphoneError === 'microphone_permission'
  const needsMicrophoneRecovery =
    microphonePermissionFailed || microphoneStatus === 'denied' || microphoneStatus === 'restricted'

  useEffect(() => {
    if (!needsMicrophoneRecovery) return
    let current = true
    let refreshPending = false

    const refreshMicrophoneStatus = () => {
      if (refreshPending) return
      refreshPending = true
      void voiceService
        .getMicrophoneStatus()
        .then((status) => {
          if (!current) return
          setMicrophoneStatus(status)
          if (status !== 'granted') return
          setMicrophoneError(undefined)
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

  const transcriptionModels = models.filter((model) => isTranscriptionModelId(model.id))
  const speechModels = models.filter((model) => isSpeechModelId(model.id))
  const canOpenMicrophoneSettings = needsMicrophoneRecovery
  const speechBusy = previewLoading || ['generating', 'ready', 'playing', 'paused'].includes(speech.phase)
  const speechError = previewFailure?.snapshot === speech ? previewFailure.reason : speech.error

  useEffect(() => {
    const refresh = () => setQueryRevision((revision) => revision + 1)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      localeSelectionGeneration.current += 1
    }
  }, [])

  const openSystemVoiceSettings = () => {
    setActionFailed(false)
    void voiceService.openSystemVoiceSettings().catch(() => setActionFailed(true))
  }

  const needsLocaleInstallation = (value: string) => {
    const locale = value === EMPTY_VALUE ? defaultLanguage : value
    return (
      recognitionDescriptor?.resourceOperations.includes(VoiceResourceOperation.InstallLocale) &&
      asrLocales?.supported.includes(locale) &&
      !asrLocales.installed.includes(locale)
    )
  }

  const selectRecognitionLanguage = async (value: string) => {
    if (value === SYSTEM_SETTINGS_VALUE) {
      openSystemVoiceSettings()
      return
    }
    if (localeSelectionPending.current) return
    const install = value.startsWith(INSTALL_LOCALE_PREFIX)
    const selection = install ? value.slice(INSTALL_LOCALE_PREFIX.length) : value
    const language = selection === EMPTY_VALUE || selection === 'auto' ? '' : selection
    const modelId = effectiveRecognitionModel
    const generation = ++localeSelectionGeneration.current
    localeSelectionPending.current = true
    if (install) installingRecognitionLocaleRef.current = true
    setInstallingLocale(install)
    setActionFailed(false)
    try {
      await setRecognitionPreferences({ language })
      if (generation !== localeSelectionGeneration.current) return
      if (install && modelId) {
        await settleSettingsInspections(pendingSettingsInspectionsRef.current)
        if (generation !== localeSelectionGeneration.current) return
        await voiceService.installTranscriptionAsset({
          modelId,
          language: language || defaultLanguage,
          source: 'settings'
        }).result
      }
    } catch (error) {
      if (generation === localeSelectionGeneration.current)
        setActionFailed(error instanceof VoiceDomainError ? error.reason : true)
    } finally {
      // Activity suspends effects without discarding the operation's pending state.
      installingRecognitionLocaleRef.current = false
      localeSelectionPending.current = false
      setInstallingLocale(false)
      if (install && modelId) setQueryRevision((revision) => revision + 1)
    }
  }

  const savePreference = (write: () => Promise<void>) => {
    setActionFailed(false)
    try {
      void write().catch(() => setActionFailed(true))
    } catch {
      setActionFailed(true)
    }
  }

  const togglePreview = async () => {
    setActionFailed(false)
    setPreviewFailure(undefined)
    previewController.current?.abort()
    previewController.current = null
    if (previewLoading) {
      setPreviewLoading(false)
      return
    }
    const controller = new AbortController()
    previewController.current = controller
    try {
      if (speechBusy) {
        await speechPlaybackService.stop()
        return
      }
      setPreviewLoading(true)
      const sampleLanguage = previewSampleCatalog(effectiveSpeechLanguage)
      await i18n.loadLanguages(sampleLanguage)
      controller.signal.throwIfAborted()
      await speechPlaybackService.start({
        text: i18n.getFixedT(sampleLanguage)('settings.voice.speech.sample'),
        trigger: 'manual',
        sourceLabel: 'preview',
        sourceEntityId: 'voice-settings',
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted || previewController.current !== controller) return
      const reason = error instanceof VoiceDomainError ? error.reason : 'operation_failed'
      if (reason !== 'aborted') setPreviewFailure({ snapshot: speechPlaybackService.getSnapshot(), reason })
    } finally {
      if (previewController.current === controller) {
        previewController.current = null
        setPreviewLoading(false)
      }
    }
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
            disabled={installingLocale}
            onValueChange={(value) => {
              if (value.startsWith(DOWNLOAD_MODEL_PREFIX)) {
                void navigate({ to: '/settings/local-models', hash: 'voice-resources' }).catch(() =>
                  setActionFailed(true)
                )
                return
              }
              savePreference(async () => {
                const modelId = value === EMPTY_VALUE ? '' : value
                await setRecognitionPreferences({
                  modelId,
                  ...(models.find((model) => model.id === modelId)?.localeSelection === null && { language: '' })
                })
              })
            }}>
            <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.recognition.model')}>
              <SelectValue>
                {recognitionModel && recognitionDescriptor?.resourceOperations.includes(VoiceResourceOperation.Download)
                  ? t(MODEL_LABEL_KEYS[recognitionDescriptor.id])
                  : undefined}
              </SelectValue>
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
              {transcriptionModels.map((model) => {
                const downloadable = model.resourceOperations.includes(VoiceResourceOperation.Download)
                const status = downloadableModelStatuses[model.id as LocalTranscriptionModelId]
                const needsDownload = downloadable && status && status.status !== 'ready'
                return (
                  <SelectItem
                    key={model.id}
                    value={needsDownload ? `${DOWNLOAD_MODEL_PREFIX}${model.id}` : model.id}
                    disabled={downloadable && !status}
                    className="group/model cursor-pointer hover:bg-accent data-[highlighted]:bg-accent [&>span:last-child]:flex-1">
                    <span>{t(MODEL_LABEL_KEYS[model.id])}</span>
                    {downloadable && status?.status !== 'ready' ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-link group-hover/model:underline group-data-[highlighted]/model:underline">
                        <Download className="size-3" aria-hidden="true" />
                        {t(
                          !status
                            ? 'common.loading'
                            : status.status === 'installing'
                              ? 'settings.dependencies.localModels.status.downloading'
                              : 'settings.dependencies.localModels.download'
                        )}
                      </span>
                    ) : null}
                  </SelectItem>
                )
              })}
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
              installingLocale ||
              (automaticLanguage ? !incompatibleLanguage : !recognitionDescriptor?.localeSelection || !asrLocales)
            }
            onValueChange={(value) => void selectRecognitionLanguage(value)}>
            <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.recognition.language')}>
              <SelectValue placeholder={t('common.select')}>
                {automaticLanguage
                  ? undefined
                  : recognitionLanguageOptions.find(
                      (option) => option.value === (languageValue(recognitionLanguage) ?? EMPTY_VALUE)
                    )?.label}
              </SelectValue>
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
                  <SelectItem
                    key={option.value}
                    className="group/locale cursor-pointer hover:bg-accent data-[highlighted]:bg-accent"
                    value={
                      needsLocaleInstallation(option.value) ? `${INSTALL_LOCALE_PREFIX}${option.value}` : option.value
                    }
                    disabled={option.disabled}>
                    <span>{option.label}</span>
                    {needsLocaleInstallation(option.value) ? (
                      <span className="inline-flex items-center gap-1 text-link group-hover/locale:underline group-data-[highlighted]/locale:underline">
                        <Download className="size-3" aria-hidden="true" />
                        {t('settings.dependencies.localModels.download')}
                      </span>
                    ) : null}
                  </SelectItem>
                ))
              )}
              {!automaticLanguage &&
              recognitionDescriptor &&
              !recognitionDescriptor.resourceOperations.includes(VoiceResourceOperation.InstallLocale) &&
              !recognitionDescriptor.resourceOperations.includes(VoiceResourceOperation.Download) ? (
                <>
                  <SelectSeparator />
                  <SelectItem value={SYSTEM_SETTINGS_VALUE}>{t('settings.voice.resources.open_settings')}</SelectItem>
                </>
              ) : null}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <div
          id="setting-voice-recognition-status"
          className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span role="status" className="text-muted-foreground">
            {t(installingLocale ? 'settings.voice.status.installing' : statusKey(recognitionStatus))}
          </span>
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
              if (value === SYSTEM_SETTINGS_VALUE) {
                openSystemVoiceSettings()
                return
              }
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
              {configuredSpeechModel ? (
                <>
                  <SelectSeparator />
                  <SelectItem value={SYSTEM_SETTINGS_VALUE}>{t('settings.voice.resources.open_settings')}</SelectItem>
                </>
              ) : null}
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
                      voiceId: value === EMPTY_VALUE ? '' : value
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
          </div>
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
