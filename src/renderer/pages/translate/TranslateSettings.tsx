import {
  Button,
  ConfirmDialog,
  Field,
  FieldDescription,
  FieldLabel,
  HelpTooltip,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  PageSidePanel,
  PageSidePanelItem,
  PageSidePanelSection,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useLanguages, useTranslateLanguages } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import { TRANSLATE_PROMPT } from '@shared/ai/prompts'
import type {
  AutoDetectionMethod,
  PersistedLangCode,
  TranslateBidirectionalPair
} from '@shared/data/preference/preferenceTypes'
import { parsePersistedLangCode, PersistedLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translateLanguages'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { ArrowLeftRight, ChevronDown, PenLine, Plus, X } from 'lucide-react'
import type { FC, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './components/IconButton'
import LanguagePicker from './components/LanguagePicker'

type Props = {
  visible: boolean
  onClose: () => void
}

const BUILTIN_LANG_CODES = new Set<string>(BUILTIN_TRANSLATE_LANGUAGES.map((lang) => lang.langCode))
const EMOJI_OPTIONS = ['🌐', '🇺🇸', '🇬🇧', '🇨🇳', '🇯🇵', '🇰🇷', '🇫🇷', '🇩🇪', '🇪🇸', '🇵🇹', '🇮🇳', '🇧🇷']
const logger = loggerService.withContext('TranslateSettings')

const TranslateSettings: FC<Props> = ({ visible, onClose }) => {
  const { t } = useTranslation()
  const [bidirectionalPair, setBidirectionalPair] = usePreference('feature.translate.page.bidirectional_pair')
  const [enableMarkdown, setEnableMarkdown] = usePreference('feature.translate.page.enable_markdown')
  const [autoCopy, setAutoCopy] = usePreference('feature.translate.page.auto_copy')
  const [autoDetectionMethod, setAutoDetectionMethod] = usePreference('feature.translate.auto_detection_method')
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = usePreference('feature.translate.page.scroll_sync')
  const [isBidirectional, setIsBidirectional] = usePreference('feature.translate.page.bidirectional_enabled')

  const safePersist = useCallback(
    async (persistPromise: Promise<unknown>, actionName: string) => {
      try {
        await persistPromise
      } catch (error) {
        logger.error(`Failed to persist ${actionName}`, error as Error)
        window.toast.error(t('common.save_failed'))
      }
    },
    [t]
  )

  const updateBidirectionalPair = useCallback(
    (next: TranslateBidirectionalPair) => {
      if (next[0] === next[1]) {
        window.toast.warning(t('translate.language.same'))
        return
      }
      void safePersist(setBidirectionalPair(next), 'translate bidirectional pair')
    },
    [safePersist, setBidirectionalPair, t]
  )

  const toggleItems: Array<{ key: string; label: string; value: boolean; onChange: (next: boolean) => void }> = [
    {
      key: 'markdown',
      label: t('translate.settings.preview'),
      value: enableMarkdown,
      onChange: (next) => void safePersist(setEnableMarkdown(next), 'translate markdown preference')
    },
    {
      key: 'autoCopy',
      label: t('translate.settings.autoCopy'),
      value: autoCopy,
      onChange: (next) => void safePersist(setAutoCopy(next), 'translate auto copy preference')
    },
    {
      key: 'scrollSync',
      label: t('translate.settings.scroll_sync'),
      value: isScrollSyncEnabled,
      onChange: (next) => void safePersist(setIsScrollSyncEnabled(next), 'translate scroll sync preference')
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

  return (
    <PageSidePanel
      open={visible}
      onClose={onClose}
      title={t('translate.settings.title')}
      closeLabel={t('translate.close')}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-5">
          {toggleItems.map((item) => (
            <PageSidePanelItem
              key={item.key}
              title={item.label}
              action={<Switch size="sm" checked={item.value} onCheckedChange={item.onChange} />}
            />
          ))}

          <PageSidePanelItem
            title={
              <span className="flex items-center gap-1">
                <span>{t('translate.detect.method.label')}</span>
                <HelpTooltip
                  content={t('translate.detect.method.tip')}
                  iconProps={{ className: 'text-foreground-muted' }}
                />
              </span>
            }
            action={
              <SegmentedControl<AutoDetectionMethod>
                size="sm"
                aria-label={t('translate.detect.method.label')}
                value={autoDetectionMethod}
                onValueChange={(value) =>
                  void safePersist(setAutoDetectionMethod(value), 'translate auto detection method')
                }
                options={detectionOptions.map((opt) => ({
                  value: opt.value,
                  label: (
                    <Tooltip content={opt.tip} placement="top">
                      <span>{opt.label}</span>
                    </Tooltip>
                  )
                }))}
              />
            }
          />

          <PageSidePanelItem
            title={
              <span className="flex items-center gap-1">
                <span>{t('translate.settings.bidirectional')}</span>
                <HelpTooltip
                  content={t('translate.settings.bidirectional_tip')}
                  iconProps={{ className: 'text-foreground-muted' }}
                />
              </span>
            }
            action={
              <Switch
                size="sm"
                checked={isBidirectional}
                onCheckedChange={(next) =>
                  void safePersist(setIsBidirectional(next), 'translate bidirectional enabled preference')
                }
              />
            }>
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
          </PageSidePanelItem>
        </div>

        <TranslatePromptField />

        <CustomLanguageList />
      </div>
    </PageSidePanel>
  )
}

const TranslateSettingsCoreContent: FC = () => {
  return (
    <div className="flex flex-col gap-8">
      <TranslatePromptField />
      <CustomLanguageList />
    </div>
  )
}

const TranslatePromptField: FC = () => {
  const { t } = useTranslation()
  const [persisted, setPersisted] = usePreference('feature.translate.model_prompt')
  const [local, setLocal] = useState<string>(persisted)
  const pendingRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFailedMessageRef = useRef(t('common.save_failed'))

  useEffect(() => {
    saveFailedMessageRef.current = t('common.save_failed')
  }, [t])

  const safePersist = useCallback(async (persistPromise: Promise<unknown>, actionName: string) => {
    try {
      await persistPromise
    } catch (error) {
      logger.error(`Failed to persist ${actionName}`, error as Error)
      window.toast.error(saveFailedMessageRef.current || 'Failed to save')
    }
  }, [])

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
        void safePersist(setPersisted(savedValue), 'translate prompt')
        pendingRef.current = null
        saveTimerRef.current = null
      }, 400)
    },
    [clearSaveTimer, safePersist, setPersisted]
  )

  useEffect(
    () => () => {
      clearSaveTimer()
      if (pendingRef.current !== null) {
        void safePersist(setPersisted(pendingRef.current), 'translate prompt')
      }
    },
    [clearSaveTimer, safePersist, setPersisted]
  )

  const isDefault = local === TRANSLATE_PROMPT
  const onReset = () => {
    clearSaveTimer()
    pendingRef.current = null
    setLocal(TRANSLATE_PROMPT)
    void safePersist(setPersisted(TRANSLATE_PROMPT), 'translate prompt')
  }

  return (
    <PageSidePanelSection
      title={t('settings.translate.prompt')}
      actions={
        !isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md text-foreground-muted text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {t('common.reset')}
          </button>
        )
      }>
      <textarea
        value={local}
        onChange={(e) => schedulePersist(e.target.value)}
        className="min-h-30 w-full resize-y rounded-md border border-border-subtle bg-muted/40 p-3 text-foreground-secondary text-sm leading-relaxed outline-none transition-colors focus:border-border-hover"
      />
    </PageSidePanelSection>
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
    <PageSidePanelSection
      title={t('translate.custom.label')}
      actions={
        customLanguages.length > 0 && (
          <span className="text-foreground-muted text-xs">{t('code.count', { count: customLanguages.length })}</span>
        )
      }>
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
            variant="outline"
            size="sm"
            onClick={() => setIsAdding(true)}
            aria-label={addLanguageLabel}
            className="mt-1 h-9 w-full">
            <Plus size={13} />
            <span>{addLanguageLabel}</span>
          </Button>
        )}
      </div>
    </PageSidePanelSection>
  )
}

type FormErrorField = 'name' | 'code'
type FormError = { field: FormErrorField; messageKey: string }
type ValidLanguageForm = { value: string; langCode: PersistedLangCode; emoji: string }
type LanguageFormValidation = { ok: false; error: FormError } | { ok: true; data: ValidLanguageForm }
const customLanguageFieldSubtitleClassName = 'text-xs font-medium leading-4 text-foreground-secondary'

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
  const [error, setError] = useState<FormError | null>(null)
  const nameId = useId()
  const codeId = useId()

  const clearError = (field: FormErrorField) => {
    if (error?.field === field) setError(null)
  }

  const validate = (): LanguageFormValidation => {
    const nextValue = value.trim()
    const nextLangCode = langCode.trim().toLowerCase()
    if (!nextValue)
      return { ok: false, error: { field: 'name', messageKey: 'settings.translate.custom.error.value.empty' } }
    if (!nextLangCode)
      return { ok: false, error: { field: 'code', messageKey: 'settings.translate.custom.error.langCode.empty' } }
    if (!PersistedLangCodeSchema.safeParse(nextLangCode).success)
      return { ok: false, error: { field: 'code', messageKey: 'settings.translate.custom.error.langCode.invalid' } }
    if (BUILTIN_LANG_CODES.has(nextLangCode))
      return { ok: false, error: { field: 'code', messageKey: 'settings.translate.custom.error.langCode.builtin' } }
    if (languages.some((language) => language.langCode === nextLangCode))
      return { ok: false, error: { field: 'code', messageKey: 'settings.translate.custom.error.langCode.exists' } }
    return { ok: true, data: { value: nextValue, langCode: parsePersistedLangCode(nextLangCode), emoji } }
  }

  const handleAdd = async () => {
    const result = validate()
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    await addLanguage(result.data)
    setValue('')
    setLangCode('')
    setEmoji('🌐')
    onAdded?.()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleAdd()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel?.()
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-muted/20 p-3" onKeyDown={handleKeyDown}>
      <Field>
        <FieldLabel htmlFor={nameId} className={customLanguageFieldSubtitleClassName}>
          {t('settings.translate.custom.value.label')}
        </FieldLabel>
        <InputGroup data-invalid={error?.field === 'name' || undefined}>
          <InputGroupAddon align="inline-start">
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </InputGroupAddon>
          <InputGroupInput
            id={nameId}
            value={value}
            autoFocus
            placeholder={t('settings.translate.custom.value.placeholder')}
            onChange={(e) => {
              setValue(e.target.value)
              clearError('name')
            }}
          />
        </InputGroup>
        {error?.field === 'name' && (
          <FieldDescription className="text-destructive">{t(error.messageKey)}</FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={codeId} className={customLanguageFieldSubtitleClassName}>
          {t('settings.translate.custom.langCode.label')}
        </FieldLabel>
        <Input
          id={codeId}
          value={langCode}
          aria-invalid={error?.field === 'code' || undefined}
          placeholder={t('settings.translate.custom.langCode.placeholder')}
          onChange={(e) => {
            setLangCode(e.target.value)
            clearError('code')
          }}
        />
        {error?.field === 'code' ? (
          <FieldDescription className="text-destructive">{t(error.messageKey)}</FieldDescription>
        ) : (
          <FieldDescription className="text-muted-foreground text-xs leading-4">
            {t('settings.translate.custom.langCode.help')}
          </FieldDescription>
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant="default" size="sm" onClick={() => void handleAdd()}>
          {t('common.add')}
        </Button>
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

  const [nameErrorKey, setNameErrorKey] = useState<string | null>(null)
  const nameId = useId()
  const codeId = useId()

  const handleSave = async () => {
    const nextValue = value.trim()
    if (!nextValue) {
      setNameErrorKey('settings.translate.custom.error.value.empty')
      return
    }
    setNameErrorKey(null)
    await updateLanguage(language.langCode, { value: nextValue, emoji })
    setEditing(false)
  }

  const handleCancel = () => {
    setValue(language.value)
    setEmoji(language.emoji)
    setNameErrorKey(null)
    setEditing(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleSave()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }

  if (!editing) {
    return (
      <>
        <div className="group flex items-center gap-2 rounded-lg px-2 py-1.25 transition-colors hover:bg-muted/30">
          <span className="min-w-0 flex-1 truncate text-foreground text-sm">{language.value}</span>
          <span className="shrink-0 font-mono text-foreground-muted text-xs">{language.langCode}</span>
          <IconButton
            size="xs"
            onClick={() => setEditing(true)}
            aria-label={t('common.edit')}
            className="text-foreground-muted/70 opacity-0 transition-opacity hover:bg-transparent group-hover:opacity-100">
            <PenLine size={10} />
          </IconButton>
          <IconButton
            size="xs"
            tone="destructive"
            onClick={() => setConfirmOpen(true)}
            aria-label={t('common.delete')}
            className="text-foreground-muted/70 opacity-0 transition-opacity hover:bg-transparent group-hover:opacity-100">
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
    <div className="space-y-3 rounded-lg bg-muted/20 p-3" onKeyDown={handleKeyDown}>
      <Field>
        <FieldLabel htmlFor={nameId} className={customLanguageFieldSubtitleClassName}>
          {t('settings.translate.custom.value.label')}
        </FieldLabel>
        <InputGroup data-invalid={nameErrorKey ? true : undefined}>
          <InputGroupAddon align="inline-start">
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </InputGroupAddon>
          <InputGroupInput
            id={nameId}
            value={value}
            autoFocus
            onChange={(e) => {
              setValue(e.target.value)
              if (nameErrorKey) setNameErrorKey(null)
            }}
          />
        </InputGroup>
        {nameErrorKey && <FieldDescription className="text-destructive">{t(nameErrorKey)}</FieldDescription>}
      </Field>
      <Field>
        <FieldLabel htmlFor={codeId} className={customLanguageFieldSubtitleClassName}>
          {t('settings.translate.custom.langCode.label')}
        </FieldLabel>
        <Input id={codeId} value={language.langCode} disabled />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant="default" size="sm" onClick={() => void handleSave()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

const EmojiPicker: FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={value}
          className={cn('h-6 gap-1 rounded-md px-1.5 text-xs', open && 'bg-accent text-accent-foreground')}>
          <span className="leading-none">{value}</span>
          <ChevronDown className={cn('size-2.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </InputGroupButton>
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

export const TranslateSettingsPanelContent: FC = () => <TranslateSettingsCoreContent />

export default memo(TranslateSettings)
