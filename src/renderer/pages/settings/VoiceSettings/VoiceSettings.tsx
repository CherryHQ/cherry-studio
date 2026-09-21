import { Copy, Download, Mic, Play, Square } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Input,
  InputNumber,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
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
  type DictationPhase,
  speechPlaybackService,
  voiceService,
  voiceTargetManager
} from '@renderer/services/voice'
import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
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

const EMPTY_VALUE = '__unconfigured__'
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
  if (status.reason === 'license_unverified') return 'settings.voice.status.license_unverified'
  if (status.reason === 'asset_required') return 'settings.voice.status.asset_required'
  if (status.reason === 'voice_unavailable') return 'settings.voice.status.voice_unavailable'
  return `settings.voice.status.${status.status}`
}

function optionalValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed || undefined
}

function languageValue(value: string | null | undefined): string | undefined {
  const language = optionalValue(value)
  return language?.toLowerCase() === 'auto' ? undefined : language
}

function storedLanguage(value: string): string {
  return value.trim().toLowerCase() === 'auto' ? '' : value
}

function transcriptionModelId(value: string | null | undefined): LocalTranscriptionModelId | undefined {
  return value === APPLE_ASR_MODEL_ID || value === FUNASR_MODEL_ID ? value : undefined
}

function VoiceSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [recognitionModel, setRecognitionModel] = usePreference('feature.voice.recognition.model_id')
  const [recognitionLanguage, setRecognitionLanguage] = usePreference('feature.voice.recognition.language')
  const [speechModel, setSpeechModel] = usePreference('feature.voice.speech.model_id')
  const [speechVoice, setSpeechVoice] = usePreference('feature.voice.speech.voice_id')
  const [speechLanguage, setSpeechLanguage] = usePreference('feature.voice.speech.language')
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
  const [models, setModels] = useState<readonly LocalVoiceModelFacts[]>([])
  const [defaultAsrModel, setDefaultAsrModel] = useState<LocalTranscriptionModelId>()
  const [voices, setVoices] = useState<readonly { id: string; name: string; language: string }[]>([])
  const [recognitionStatus, setRecognitionStatus] = useState<StatusState>({ status: 'unconfigured' })
  const [speechStatus, setSpeechStatus] = useState<StatusState>({ status: 'unconfigured' })
  const [microphoneStatus, setMicrophoneStatus] =
    useState<Awaited<ReturnType<typeof voiceService.getMicrophoneStatus>>>('unknown')
  const [installing, setInstalling] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
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
        const [modelResult, voiceResult, microphoneResult] = await Promise.allSettled([
          voiceService.listModels(),
          voiceService.listVoices(),
          voiceService.getMicrophoneStatus()
        ])
        if (!current) return
        if (modelResult.status === 'fulfilled') {
          setModels(modelResult.value.models)
          setDefaultAsrModel(modelResult.value.defaultAsrModelId)
        }
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

  useEffect(() => {
    if (hasConfiguredRecognitionModel && !configuredRecognitionModel) {
      setRecognitionStatus({ status: 'unsupported', reason: 'unsupported' })
      return
    }
    if (!effectiveRecognitionModel) {
      setRecognitionStatus({ status: 'unconfigured' })
      return
    }
    let current = true
    void voiceService
      .getModelStatus({
        modelId: effectiveRecognitionModel,
        ...(languageValue(recognitionLanguage) && { language: languageValue(recognitionLanguage) })
      })
      .then((status) => {
        if (current) setRecognitionStatus(status)
      })
      .catch(() => {
        if (current) setRecognitionStatus({ status: 'failed', reason: 'operation_failed' })
      })
    return () => {
      current = false
    }
  }, [configuredRecognitionModel, effectiveRecognitionModel, hasConfiguredRecognitionModel, recognitionLanguage])

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
        captureReplaceRange: () => {
          const field = transcriptRef.current
          return field ? { from: field.selectionStart, to: field.selectionEnd } : null
        },
        replaceRange: ({ from, to }, text) => {
          const current = transcriptValueRef.current
          if (from > current.length || to > current.length) return false
          setTranscript(`${current.slice(0, from)}${text}${current.slice(to)}`)
          return true
        }
      }),
    []
  )

  const transcriptionModels = models.filter((model) => model.id === APPLE_ASR_MODEL_ID || model.id === FUNASR_MODEL_ID)
  const speechModels = models.filter((model) => model.id === APPLE_TTS_MODEL_ID)
  const canInstallApple =
    recognitionModel === APPLE_ASR_MODEL_ID &&
    Boolean(languageValue(recognitionLanguage)) &&
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
    const language = languageValue(recognitionLanguage)
    if (!language || !canInstallApple) return
    const previousStatus = recognitionStatus
    setInstalling(true)
    setRecognitionStatus({ status: 'installing', reason: 'asset_required' })
    setActionFailed(false)
    try {
      await voiceService.installTranscriptionAsset({ language, source: 'settings' }).result
      setRecognitionStatus(await voiceService.getModelStatus({ modelId: APPLE_ASR_MODEL_ID, language }))
    } catch {
      setRecognitionStatus(previousStatus)
      setActionFailed(true)
    } finally {
      setInstalling(false)
    }
  }

  const toggleDictation = () => {
    setActionFailed(false)
    if (dictationRecording) {
      void dictationService.stop().catch(() => setActionFailed(true))
      return
    }
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
          <SettingRowTitle>{t('settings.voice.recognition.model')}</SettingRowTitle>
          <Select
            value={recognitionModel || EMPTY_VALUE}
            onValueChange={(value) => savePreference(() => setRecognitionModel(value === EMPTY_VALUE ? '' : value))}>
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
          <Input
            className="w-64"
            aria-label={t('settings.voice.recognition.language')}
            placeholder={t('settings.voice.language.placeholder')}
            value={languageValue(recognitionLanguage) ?? ''}
            onChange={(event) => savePreference(() => setRecognitionLanguage(storedLanguage(event.target.value)))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-recognition-status" className="scroll-mt-6">
          <div>
            <SettingRowTitle>{t('settings.voice.status.label')}</SettingRowTitle>
            <SettingDescription className="mt-1">{t(statusKey(recognitionStatus))}</SettingDescription>
          </div>
          {canInstallApple ? (
            <Button disabled={installing} onClick={() => void installAppleAsset()}>
              <Download className="size-4" />
              {t('settings.voice.action.install')}
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
        <SettingRow id="setting-voice-speech-voice" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.voice.speech.voice')}</SettingRowTitle>
          <Select
            value={speechVoice || EMPTY_VALUE}
            onValueChange={(value) => savePreference(() => setSpeechVoice(value === EMPTY_VALUE ? '' : value))}>
            <SelectTrigger className="w-64" aria-label={t('settings.voice.speech.voice')}>
              <SelectValue placeholder={t('settings.voice.unconfigured')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_VALUE}>{t('settings.voice.unconfigured')}</SelectItem>
              {voices.map((voice) => (
                <SelectItem key={voice.id} value={voice.id}>
                  {voice.name} ({voice.language})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-voice-speech-language" className="scroll-mt-6">
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Input
            className="w-64"
            aria-label={t('settings.voice.speech.language')}
            placeholder={t('settings.voice.language.placeholder')}
            value={languageValue(speechLanguage) ?? ''}
            onChange={(event) => savePreference(() => setSpeechLanguage(storedLanguage(event.target.value)))}
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
          {t('settings.voice.status.operation_failed')}
        </p>
      ) : null}
    </SettingsContentColumn>
  )
}

export default VoiceSettings
