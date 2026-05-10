import {
  Button,
  ConfirmDialog,
  HelpTooltip,
  PageSidePanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useLanguages, useTranslateLanguages } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import type { AutoDetectionMethod, TranslateBidirectionalPair } from '@shared/data/preference/preferenceTypes'
import { parsePersistedLangCode, PersistedLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translate-languages'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { ArrowLeftRight, Check, PenLine, Plus, SlidersHorizontal, X } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './components/IconButton'
import LanguagePicker from './components/LanguagePicker'

type Props = {
  visible: boolean
  onClose: () => void
}

const BUILTIN_LANG_CODES = new Set<string>(BUILTIN_TRANSLATE_LANGUAGES.map((lang) => lang.langCode))
const EMOJI_OPTIONS = ['🌐', '🇺🇸', '🇬🇧', '🇨🇳', '🇯🇵', '🇰🇷', '🇫🇷', '🇩🇪', '🇪🇸', '🇵🇹', '🇮🇳', '🇧🇷']

const TranslateSettings: FC<Props> = ({ visible, onClose }) => {
  const { t } = useTranslation()
  const [bidirectionalPair, setBidirectionalPair] = usePreference('feature.translate.page.bidirectional_pair')
  const [enableMarkdown, setEnableMarkdown] = usePreference('feature.translate.page.enable_markdown')
  const [autoCopy, setAutoCopy] = usePreference('feature.translate.page.auto_copy')
  const [autoDetectionMethod, setAutoDetectionMethod] = usePreference('feature.translate.auto_detection_method')
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = usePreference('feature.translate.page.scroll_sync')
  const [isBidirectional, setIsBidirectional] = usePreference('feature.translate.page.bidirectional_enabled')

  const updateBidirectionalPair = useCallback(
    (next: TranslateBidirectionalPair) => {
      if (next[0] === next[1]) {
        window.toast.warning(t('translate.language.same'))
        return
      }
      void setBidirectionalPair(next)
    },
    [setBidirectionalPair, t]
  )

  const toggleItems: Array<{ key: string; label: string; value: boolean; onChange: (next: boolean) => void }> = [
    {
      key: 'markdown',
      label: t('translate.settings.preview'),
      value: enableMarkdown,
      onChange: (next) => void setEnableMarkdown(next)
    },
    {
      key: 'autoCopy',
      label: t('translate.settings.autoCopy'),
      value: autoCopy,
      onChange: (next) => void setAutoCopy(next)
    },
    {
      key: 'scrollSync',
      label: t('translate.settings.scroll_sync'),
      value: isScrollSyncEnabled,
      onChange: (next) => void setIsScrollSyncEnabled(next)
    }
  ]

  const detectionOptions: Array<{ value: AutoDetectionMethod; label: string; tip: string }> = [
    {
      value: 'auto',
      label: t('translate.detect.method.auto.label'),
      tip: t('translate.detect.method.auto.tip')
    },
    {
      value: 'franc',
      label: t('translate.detect.method.algo.label'),
      tip: t('translate.detect.method.algo.tip')
    },
    {
      value: 'llm',
      label: t('translate.detect.method.llm.label'),
      tip: t('translate.detect.method.llm.tip')
    }
  ]

  const header = (
    <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
      <SlidersHorizontal size={12} className="text-muted-foreground" />
      <span>{t('translate.settings.title')}</span>
    </span>
  )

  return (
    <PageSidePanel open={visible} onClose={onClose} header={header} closeLabel={t('translate.close')}>
      {toggleItems.map((item) => (
        <div key={item.key} className="flex items-center justify-between gap-4">
          <span className="text-foreground text-sm">{item.label}</span>
          <Switch size="sm" checked={item.value} onCheckedChange={item.onChange} />
        </div>
      ))}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <span className="text-foreground text-sm">{t('translate.detect.method.label')}</span>
          <HelpTooltip content={t('translate.detect.method.tip')} iconProps={{ className: 'text-foreground-muted' }} />
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border/50 bg-card p-0.5">
          {detectionOptions.map((opt) => (
            <Tooltip key={opt.value} content={opt.tip} placement="top">
              <button
                type="button"
                onClick={() => void setAutoDetectionMethod(opt.value)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  autoDetectionMethod === opt.value
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {opt.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-foreground text-sm">{t('translate.settings.bidirectional')}</span>
            <HelpTooltip
              content={t('translate.settings.bidirectional_tip')}
              iconProps={{ className: 'text-foreground-muted' }}
            />
          </div>
          <Switch size="sm" checked={isBidirectional} onCheckedChange={(next) => void setIsBidirectional(next)} />
        </div>
        {isBidirectional && (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <LanguagePicker
                value={bidirectionalPair[0]}
                onChange={(value) => updateBidirectionalPair([value, bidirectionalPair[1]])}
              />
            </div>
            <ArrowLeftRight size={12} className="shrink-0 text-foreground-muted" />
            <div className="flex-1">
              <LanguagePicker
                value={bidirectionalPair[1]}
                onChange={(value) => updateBidirectionalPair([bidirectionalPair[0], value])}
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-border/40 border-t" />

      <TranslatePromptField />

      <CustomLanguageList />
    </PageSidePanel>
  )
}

const TranslatePromptField: FC = () => {
  const { t } = useTranslation()
  const [persisted, setPersisted] = usePreference('feature.translate.model_prompt')
  const [local, setLocal] = useState<string>(persisted)
  const pendingRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (pendingRef.current === null || pendingRef.current === persisted) {
      setLocal(persisted)
      pendingRef.current = null
    }
  }, [persisted])

  const schedulePersist = useCallback(
    (next: string) => {
      clearSaveTimer()
      pendingRef.current = next
      setLocal(next)

      const savedValue = next
      saveTimerRef.current = setTimeout(() => {
        void setPersisted(savedValue)
        pendingRef.current = null
        saveTimerRef.current = null
      }, 400)
    },
    [clearSaveTimer, setPersisted]
  )

  useEffect(
    () => () => {
      clearSaveTimer()
      if (pendingRef.current !== null) {
        void setPersisted(pendingRef.current)
      }
    },
    [clearSaveTimer, setPersisted]
  )

  const isDefault = local === TRANSLATE_PROMPT
  const onReset = () => {
    clearSaveTimer()
    pendingRef.current = null
    setLocal(TRANSLATE_PROMPT)
    void setPersisted(TRANSLATE_PROMPT)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-sm">{t('settings.translate.prompt')}</span>
        {!isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md text-foreground-muted text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {t('common.reset')}
          </button>
        )}
      </div>
      <textarea
        value={local}
        onChange={(e) => schedulePersist(e.target.value)}
        className="min-h-[120px] w-full resize-y rounded-md border border-border/30 bg-muted/40 p-3 text-foreground-secondary text-sm leading-relaxed outline-none transition-colors focus:border-border-hover"
      />
    </div>
  )
}

const CustomLanguageList: FC = () => {
  const { t, i18n } = useTranslation()
  const { languages } = useLanguages()
  const [isAdding, setIsAdding] = useState(false)

  const customLanguages = useMemo(
    () =>
      languages?.filter(
        (language) => language.langCode !== UNKNOWN_LANG_CODE && !BUILTIN_LANG_CODES.has(language.langCode)
      ) ?? [],
    [languages]
  )

  const addLanguageLabel = i18n.language.startsWith('zh')
    ? `${t('common.add')}${t('common.language')}`
    : `${t('common.add')} ${t('common.language')}`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-sm">{t('translate.custom.label')}</span>
        {customLanguages.length > 0 && (
          <span className="text-muted-foreground/40 text-xs">{t('code.count', { count: customLanguages.length })}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {customLanguages.map((language) => (
          <CustomLanguageRow key={language.langCode} language={language} />
        ))}
        {customLanguages.length === 0 && !isAdding && (
          <p className="rounded-md bg-muted/30 px-2 py-2 text-center text-muted-foreground text-sm">
            {t('common.no_results')}
          </p>
        )}
        {isAdding ? (
          <AddCustomLanguageForm
            languages={languages ?? []}
            onAdded={() => setIsAdding(false)}
            onCancel={() => setIsAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
            aria-label={addLanguageLabel}
            className="mt-1 h-9 w-full rounded-xl bg-muted/60 text-muted-foreground/60 shadow-none hover:bg-muted hover:text-foreground">
            <Plus size={13} />
            <span>{addLanguageLabel}</span>
          </Button>
        )}
      </div>
    </div>
  )
}

const AddCustomLanguageForm: FC<{ languages: TranslateLanguage[]; onAdded?: () => void; onCancel?: () => void }> = ({
  languages,
  onAdded,
  onCancel
}) => {
  const { t } = useTranslation()
  const { add: addLanguage } = useTranslateLanguages()
  const [value, setValue] = useState('')
  const [langCode, setLangCode] = useState('')
  const [emoji, setEmoji] = useState('🌐')

  const validate = () => {
    const nextValue = value.trim()
    const nextLangCode = langCode.trim().toLowerCase()
    if (!nextValue) {
      window.toast.error(t('settings.translate.custom.error.value.empty'))
      return null
    }
    if (!nextLangCode) {
      window.toast.error(t('settings.translate.custom.error.langCode.empty'))
      return null
    }
    if (!PersistedLangCodeSchema.safeParse(nextLangCode).success) {
      window.toast.error(t('settings.translate.custom.error.langCode.invalid'))
      return null
    }
    if (BUILTIN_LANG_CODES.has(nextLangCode)) {
      window.toast.error(t('settings.translate.custom.error.langCode.builtin'))
      return null
    }
    if (languages.some((language) => language.langCode === nextLangCode)) {
      window.toast.error(t('settings.translate.custom.error.langCode.exists'))
      return null
    }
    return { value: nextValue, langCode: parsePersistedLangCode(nextLangCode), emoji }
  }

  const handleAdd = async () => {
    const next = validate()
    if (!next) return
    await addLanguage(next)
    setValue('')
    setLangCode('')
    setEmoji('🌐')
    onAdded?.()
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/50 border-dashed bg-muted/20 p-2">
      <div className="flex items-center gap-1.5">
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('settings.translate.custom.value.placeholder')}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={langCode}
          onChange={(e) => setLangCode(e.target.value)}
          placeholder={t('settings.translate.custom.langCode.placeholder')}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
        />
        <IconButton
          size="md"
          onClick={() => void handleAdd()}
          aria-label={t('common.add')}
          className="bg-primary text-primary-foreground hover:opacity-90">
          <Check size={12} />
        </IconButton>
        <IconButton size="md" onClick={onCancel} aria-label={t('common.cancel')}>
          <X size={12} />
        </IconButton>
      </div>
    </div>
  )
}

const CustomLanguageRow: FC<{ language: TranslateLanguage }> = ({ language }) => {
  const { t } = useTranslation()
  const { update: updateLanguage, remove: deleteLanguage } = useTranslateLanguages()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(language.value)
  const [emoji, setEmoji] = useState(language.emoji)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    setValue(language.value)
    setEmoji(language.emoji)
  }, [language.emoji, language.value])

  const handleSave = async () => {
    const nextValue = value.trim()
    if (!nextValue) {
      window.toast.error(t('settings.translate.custom.error.value.empty'))
      return
    }
    await updateLanguage(language.langCode, { value: nextValue, emoji })
    setEditing(false)
  }

  const handleCancel = () => {
    setValue(language.value)
    setEmoji(language.emoji)
    setEditing(false)
  }

  if (!editing) {
    return (
      <>
        <div className="group flex items-center gap-2 rounded-lg px-2 py-[5px] transition-colors hover:bg-muted/30">
          <span className="min-w-0 flex-1 truncate text-foreground text-sm">{language.value}</span>
          <span className="shrink-0 font-mono text-muted-foreground/50 text-xs">{language.langCode}</span>
          <IconButton
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={t('common.edit')}
            className="opacity-0 transition-opacity group-hover:opacity-100">
            <PenLine size={10} />
          </IconButton>
          <IconButton
            size="sm"
            tone="destructive"
            onClick={() => setConfirmOpen(true)}
            aria-label={t('common.delete')}
            className="opacity-0 transition-opacity group-hover:opacity-100">
            <X size={10} />
          </IconButton>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('settings.translate.custom.delete.title')}
          description={t('settings.translate.custom.delete.description')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          destructive
          onConfirm={() => deleteLanguage(language.langCode)}
        />
      </>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/20 p-2">
      <div className="flex items-center gap-1.5">
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={language.langCode}
          disabled
          className="min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-muted-foreground text-sm outline-none"
        />
        <IconButton
          size="md"
          onClick={() => void handleSave()}
          aria-label={t('common.save')}
          className="bg-primary text-primary-foreground hover:opacity-90">
          <Check size={12} />
        </IconButton>
        <IconButton size="md" onClick={handleCancel} aria-label={t('common.cancel')}>
          <X size={12} />
        </IconButton>
      </div>
    </div>
  )
}

const EmojiPicker: FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-36 rounded-md border border-border bg-popover p-1 shadow-xl">
        <div className="grid grid-cols-4 gap-1">
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji)
                setOpen(false)
              }}
              className={cn(
                'flex h-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent',
                emoji === value && 'bg-accent'
              )}>
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export const TranslateSettingsPanelContent: FC = () => (
  <>
    <TranslatePromptField />
    <CustomLanguageList />
  </>
)

export default memo(TranslateSettings)
