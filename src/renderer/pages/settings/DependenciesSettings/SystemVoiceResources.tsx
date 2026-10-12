import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { getDefaultVoiceLanguage, voiceService } from '@renderer/services/voice'
import { isTranscriptionModelId, VoiceResourceOperation, type LocalTranscriptionModelId } from '@shared/ai/localVoice'
import type { OutputFor } from '@shared/ipc/types'

const statusKeys = {
  ready: 'settings.voice.status.ready',
  not_installed: 'settings.voice.status.not_installed',
  installing: 'settings.voice.status.installing',
  unsupported: 'settings.voice.status.unsupported',
  failed: 'settings.voice.status.failed'
} as const

function SystemVoiceLocale({ modelId }: { modelId: LocalTranscriptionModelId }) {
  const { t, i18n } = useTranslation()
  const [preferredLanguage] = usePreference('feature.voice.recognition.language')
  const [language, setLanguage] = useState(
    preferredLanguage && preferredLanguage !== 'auto'
      ? preferredLanguage
      : getDefaultVoiceLanguage(i18n.resolvedLanguage ?? i18n.language)
  )
  const [locales, setLocales] = useState<string[]>([])
  const [status, setStatus] = useState<OutputFor<'ai.voice.model.status'>>()
  const [installing, setInstalling] = useState(false)
  const [revision, setRevision] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    setStatus(undefined)
    setFailed(false)
    void Promise.all([
      voiceService.listTranscriptionLocales(modelId),
      voiceService.getModelStatus({ modelId, language })
    ])
      .then(([locales, status]) => {
        if (current) {
          setLocales(locales.supported)
          setStatus(status)
        }
      })
      .catch(() => {
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [modelId, language, revision])
  const install = async () => {
    setInstalling(true)
    setFailed(false)
    try {
      await voiceService.installTranscriptionAsset({ modelId, language, source: 'settings' }).result
      setRevision((value) => value + 1)
    } catch {
      setFailed(true)
    } finally {
      setInstalling(false)
    }
  }
  const names = new Intl.DisplayNames([i18n.language], { type: 'language' })
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">{t('settings.voice.resources.recognition')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={language} onValueChange={setLanguage} disabled={installing}>
          <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.voice.recognition.language')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from(new Set([language, ...locales])).map((locale) => (
              <SelectItem key={locale} value={locale} disabled={!locales.includes(locale)}>
                {names.of(locale) ?? locale}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {status?.status !== 'ready' ? (
          <Button
            variant="outline"
            disabled={
              installing ||
              !locales.includes(language) ||
              !status ||
              status.status === 'unsupported' ||
              status.status === 'installing'
            }
            onClick={() => void install()}>
            {t(installing ? 'settings.voice.status.installing' : 'settings.voice.action.install')}
          </Button>
        ) : null}
        <span role="status" className="text-sm text-muted-foreground">
          {status ? t(statusKeys[status.status]) : t('common.loading')}
        </span>
      </div>
      {failed ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {t('settings.voice.status.operation_failed')}
          <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default function SystemVoiceResources() {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<OutputFor<'ai.voice.models.list'>>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setFailed(false)
    void voiceService
      .listModels()
      .then((catalog) => {
        if (current) setCatalog(catalog)
      })
      .catch(() => {
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [revision])
  const models =
    catalog?.models.filter(
      (model) =>
        model.resourceOperations.includes(VoiceResourceOperation.InstallLocale) && isTranscriptionModelId(model.id)
    ) ?? []
  const hasSystemModels = catalog?.models.some(
    (model) => !model.resourceOperations.includes(VoiceResourceOperation.Download)
  )
  if (!hasSystemModels && !failed) return null
  return (
    <section id="system-voice-resources" className="mt-6 space-y-3" aria-labelledby="system-voice-title">
      <h2 id="system-voice-title" className="text-base font-semibold">
        {t('settings.voice.resources.system')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('settings.voice.resources.system_description')}</p>
      {failed ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {t('settings.voice.status.operation_failed')}
          <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {models.map((model) => (
        <SystemVoiceLocale key={model.id} modelId={model.id as LocalTranscriptionModelId} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {hasSystemModels ? (
          <Button
            variant="outline"
            onClick={() => void voiceService.openSystemVoiceSettings().catch(() => setFailed(true))}>
            {t('settings.voice.resources.open_settings')}
          </Button>
        ) : null}
        <Link to="/settings/voice" className="inline-block text-sm text-link hover:underline">
          {t('settings.voice.resources.return')}
        </Link>
      </div>
    </section>
  )
}
