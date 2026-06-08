import {
  Badge,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { Volume2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ComponentLabWebSpeechSettings')

type SpeakStatus = 'idle' | 'speaking'

// macOS bundles many low-quality voices with no real TTS use. Filtering by name is a
// no-op on Windows/Linux since these names don't exist there. Each Eloquence voice
// shares one name across all its languages, so a single entry filters every variant.
const MACOS_LOW_QUALITY_VOICES = new Set([
  // Legacy novelty voices (instrument / robot / sound-effect)
  'Albert',
  'Bad News',
  'Bahh',
  'Bells',
  'Boing',
  'Bubbles',
  'Cellos',
  'Deranged',
  'Good News',
  'Hysterical',
  'Jester',
  'Organ',
  'Pipe Organ',
  'Superstar',
  'Trinoids',
  'Whisper',
  'Wobble',
  'Zarvox',
  // Eloquence family (retro screen-reader voices, robotic)
  'Eddy',
  'Flo',
  'Grandma',
  'Grandpa',
  'Reed',
  'Rocko',
  'Sandy',
  'Shelley',
  // Legacy MacinTalk voices (robotic formant synthesis, pre-modern macOS). Alex is a
  // later high-quality voice and is intentionally NOT listed here.
  'Agnes',
  'Bruce',
  'Fred',
  'Junior',
  'Kathy',
  'Princess',
  'Ralph',
  'Vicki',
  'Victoria',
  // Other low-quality voices found in testing (series unconfirmed)
  'Jacques' // fr-FR
])

// Chromium appends a localized language label to the name, following the app's UI language,
// e.g. "Eddy (English (United States))" or, in a CJK UI, "Shelley (葡萄牙语（巴西）)". Strip the
// trailing parenthetical (half- or full-width) so the base name matches regardless of UI language.
const baseVoiceName = (name: string) => name.replace(/\s*[(（].*[)）]\s*$/, '').trim()

const isUsableVoice = (voice: SpeechSynthesisVoice) => {
  // The whole Eloquence family lives in this URI namespace, regardless of name/language.
  if (/(^|\W)eloquence(\W|$)/i.test(voice.voiceURI)) return false
  return !MACOS_LOW_QUALITY_VOICES.has(voice.name) && !MACOS_LOW_QUALITY_VOICES.has(baseVoiceName(voice.name))
}

// Sample text seeded into the textarea when its matching language is selected.
// Keys mirror the UI languages supported in CommonSettings; matched against voice.lang.
const DEFAULT_TEXT_BY_LANG: Record<string, string> = {
  'zh-CN': '明月几时有？把酒问青天。', // Su Shi
  'zh-TW': '明月幾時有？把酒問青天。', // Su Shi (Traditional)
  'en-US': 'To be or not to be, this is a question.', // Shakespeare
  'de-DE': 'Es irrt der Mensch, solang er strebt.', // Goethe, Faust
  'ja-JP': '古池や、蛙飛び込む、水の音。', // Bashō
  'ru-RU': 'Я помню чудное мгновенье.', // Pushkin
  'el-GR': 'Σαν βγεις στον πηγαιμό για την Ιθάκη.', // Cavafy, Ithaka
  'es-ES': 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme.', // Cervantes, Don Quijote
  'fr-FR': 'Je pense, donc je suis.', // Descartes
  'pt-PT': 'Navegar é preciso, viver não é preciso.', // Pessoa
  'ro-RO': 'A fost odată ca-n povești, a fost ca niciodată.', // Eminescu, Luceafărul
  'vi-VN': 'Trăm năm trong cõi người ta, chữ tài chữ mệnh khéo là ghét nhau.' // Nguyễn Du, Truyện Kiều
}

const ComponentLabWebSpeechSettings: FC = () => {
  const { t } = useTranslation()
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const [rawVoices, setRawVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('')
  const [selectedLang, setSelectedLang] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SpeakStatus>('idle')

  // getVoices() is frequently empty on the first synchronous call; the browser
  // populates the list asynchronously and emits `voiceschanged` when it is ready.
  useEffect(() => {
    if (!speechSupported) return

    const synth = window.speechSynthesis
    const loadVoices = () => setRawVoices(synth.getVoices())

    loadVoices()
    synth.addEventListener('voiceschanged', loadVoices)
    return () => synth.removeEventListener('voiceschanged', loadVoices)
  }, [speechSupported])

  const voices = useMemo(() => rawVoices.filter(isUsableVoice), [rawVoices])

  // Unique BCP-47 langs derived from the available voices.
  const langs = useMemo(() => Array.from(new Set(voices.map((voice) => voice.lang).filter(Boolean))).sort(), [voices])

  // Voices belonging to the currently selected language.
  const voicesForLang = useMemo(() => voices.filter((voice) => voice.lang === selectedLang), [voices, selectedLang])

  // Seed the voice/lang selections from the platform default once voices arrive.
  useEffect(() => {
    if (!voices.length) return

    const defaultVoice = voices.find((voice) => voice.default) ?? voices[0]
    setSelectedVoiceURI((current) => current || defaultVoice.voiceURI)
    setSelectedLang((current) => current || defaultVoice.lang)
    setText((current) => current || (DEFAULT_TEXT_BY_LANG[defaultVoice.lang] ?? ''))
  }, [voices])

  // Stop any in-flight speech when leaving the tab.
  useEffect(() => {
    return () => {
      if (speechSupported) window.speechSynthesis.cancel()
    }
  }, [speechSupported])

  const handleSpeak = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return

    const synth = window.speechSynthesis
    // Cancel any in-flight utterance so re-clicking restarts cleanly.
    synth.cancel()

    const utterance = new SpeechSynthesisUtterance(trimmed)
    // `voice` and `lang` are independent properties on the utterance — set both so
    // we can observe how the engine resolves a voice/lang pairing.
    const voice = voices.find((item) => item.voiceURI === selectedVoiceURI)
    if (voice) utterance.voice = voice
    if (selectedLang) utterance.lang = selectedLang

    utterance.onstart = () => setStatus('speaking')
    utterance.onend = () => setStatus('idle')
    utterance.onerror = (event) => {
      setStatus('idle')
      // `interrupted`/`canceled` are expected when cancel() runs before re-speaking.
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        logger.error('Web Speech synthesis failed', new Error(event.error))
      }
    }

    synth.speak(utterance)
  }, [selectedLang, selectedVoiceURI, text, voices])

  const handleLangChange = useCallback(
    (lang: string) => {
      setSelectedLang(lang)
      // Replace the textarea with the language's sample text when one is defined.
      const sample = DEFAULT_TEXT_BY_LANG[lang]
      if (sample !== undefined) setText(sample)
      // The current voice may not belong to the new language; switch to one that does.
      const nextVoice =
        voices.find((voice) => voice.lang === lang && voice.default) ?? voices.find((voice) => voice.lang === lang)
      setSelectedVoiceURI(nextVoice?.voiceURI ?? '')
    },
    [voices]
  )

  if (!speechSupported) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-muted-foreground text-sm">
        {t('settings.componentLab.webSpeech.unsupported')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="font-medium text-foreground text-sm">{t('settings.componentLab.webSpeech.title')}</div>
        <div className="mt-1 text-muted-foreground text-xs">{t('settings.componentLab.webSpeech.description')}</div>
      </div>

      <div className="max-w-2xl space-y-4 rounded-xl border border-border bg-background p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('settings.componentLab.webSpeech.voiceLabel')}</Label>
            <Select value={selectedVoiceURI} onValueChange={setSelectedVoiceURI} disabled={!voicesForLang.length}>
              <SelectTrigger className="w-full" data-testid="component-lab-web-speech-voice-select">
                <SelectValue placeholder={t('settings.componentLab.webSpeech.voicePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {voicesForLang.map((voice) => (
                  <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('settings.componentLab.webSpeech.langLabel')}</Label>
            <Select value={selectedLang} onValueChange={handleLangChange} disabled={!langs.length}>
              <SelectTrigger className="w-full" data-testid="component-lab-web-speech-lang-select">
                <SelectValue placeholder={t('settings.componentLab.webSpeech.langPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {langs.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t('settings.componentLab.webSpeech.textLabel')}</Label>
          <Textarea.Input
            value={text}
            onValueChange={setText}
            placeholder={t('settings.componentLab.webSpeech.textPlaceholder')}
            rows={4}
            data-testid="component-lab-web-speech-text"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSpeak} disabled={!text.trim() || !voices.length}>
            <Volume2 className="size-4" />
            {t('settings.componentLab.webSpeech.speak')}
          </Button>
          <Badge variant="outline">
            {status === 'speaking'
              ? t('settings.componentLab.webSpeech.status.speaking')
              : t('settings.componentLab.webSpeech.status.idle')}
          </Badge>
          {!voices.length ? (
            <span className="text-muted-foreground text-xs">{t('settings.componentLab.webSpeech.noVoices')}</span>
          ) : null}
        </div>
      </div>

      {/* Debug-only inspection: dump every raw voice so we can read the real name/lang/voiceURI
          per platform. Filtered-out voices are struck through. */}
      <div className="max-w-2xl rounded-xl border border-border bg-background p-4">
        <div className="mb-2 font-medium text-foreground text-xs">
          All voices (raw): {rawVoices.length} · usable: {voices.length}
        </div>
        <div className="max-h-64 space-y-0.5 overflow-auto font-mono text-foreground text-xs leading-5">
          {rawVoices.map((voice) => (
            <div
              key={voice.voiceURI}
              className={isUsableVoice(voice) ? 'text-foreground' : 'text-muted-foreground line-through'}>
              {voice.name} · {voice.lang} · {voice.voiceURI}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ComponentLabWebSpeechSettings
