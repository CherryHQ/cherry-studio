import { HelpTooltip, Popover, PopoverContent, PopoverTrigger, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import LanguageSelect from '@renderer/components/LanguageSelect'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import {
  addCustomLanguage,
  deleteCustomLanguage,
  getAllCustomLanguages,
  updateCustomLanguage
} from '@renderer/services/TranslateService'
import type { AutoDetectionMethod, CustomTranslateLanguage, TranslateLanguage } from '@renderer/types'
import { cn } from '@renderer/utils'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { ArrowLeftRight, Check, PenLine, Plus, SlidersHorizontal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
// TODO(v2/pr-14315): Replace the custom motion.div drawer + useDrawerFocus
// with `<PageSidePanel>` from `@cherrystudio/ui` once this page consumes that
// composite.
import { useTranslation } from 'react-i18next'

import IconButton from './components/IconButton'
import { useDrawerFocus } from './components/useDrawerFocus'

type Props = {
  visible: boolean
  onClose: () => void
  isScrollSyncEnabled: boolean
  setIsScrollSyncEnabled: (value: boolean) => void
  isBidirectional: boolean
  setIsBidirectional: (value: boolean) => void
  enableMarkdown: boolean
  setEnableMarkdown: (value: boolean) => void
  bidirectionalPair: [TranslateLanguage, TranslateLanguage]
  setBidirectionalPair: (value: [TranslateLanguage, TranslateLanguage]) => void
  autoDetectionMethod: AutoDetectionMethod
  setAutoDetectionMethod: (method: AutoDetectionMethod) => void
}

const TranslateSettings: FC<Props> = ({
  visible,
  onClose,
  isScrollSyncEnabled,
  setIsScrollSyncEnabled,
  isBidirectional,
  setIsBidirectional,
  enableMarkdown,
  setEnableMarkdown,
  bidirectionalPair,
  setBidirectionalPair,
  autoDetectionMethod,
  setAutoDetectionMethod
}) => {
  const { t } = useTranslation()
  const { getLanguageByLangcode, settings, updateSettings } = useTranslate()
  const { autoCopy } = settings
  const drawerRef = useRef<HTMLDivElement>(null)
  useDrawerFocus(visible, drawerRef)

  const updateBidirectionalPair = (next: [TranslateLanguage, TranslateLanguage]) => {
    if (next[0] === next[1]) {
      window.toast.warning(t('translate.language.same'))
      return
    }
    setBidirectionalPair(next)
    void db.settings.put({
      id: 'translate:bidirectional:pair',
      value: [next[0].langCode, next[1].langCode]
    })
  }

  const toggleItems: Array<{ key: string; label: string; value: boolean; onChange: (next: boolean) => void }> = [
    {
      key: 'markdown',
      label: t('translate.settings.preview'),
      value: enableMarkdown,
      onChange: (next) => {
        setEnableMarkdown(next)
        void db.settings.put({ id: 'translate:markdown:enabled', value: next })
      }
    },
    {
      key: 'autoCopy',
      label: t('translate.settings.autoCopy'),
      value: autoCopy,
      onChange: (next) => updateSettings({ autoCopy: next })
    },
    {
      key: 'scrollSync',
      label: t('translate.settings.scroll_sync'),
      value: isScrollSyncEnabled,
      onChange: (next) => {
        setIsScrollSyncEnabled(next)
        void db.settings.put({ id: 'translate:scroll:sync', value: next })
      }
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
      label: 'LLM',
      tip: t('translate.detect.method.llm.tip')
    }
  ]

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            key="translate-settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40 bg-black/5"
            onClick={onClose}
          />
          <motion.div
            ref={drawerRef}
            key="translate-settings-drawer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
              }
            }}
            className="absolute top-0 right-0 bottom-0 z-50 flex w-[300px] flex-col overflow-hidden rounded-l-xs border-border border-l bg-popover shadow-lg"
            tabIndex={-1}>
            <div className="flex h-11 shrink-0 items-center justify-between border-border/30 border-b px-4">
              <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                <SlidersHorizontal size={12} className="text-muted-foreground" />
                <span>{t('translate.settings.title')}</span>
              </span>
              <IconButton size="md" onClick={onClose} aria-label={t('translate.close')}>
                <X size={12} />
              </IconButton>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
              {toggleItems.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-4">
                  <span className="text-foreground text-xs">{item.label}</span>
                  <Switch size="sm" checked={item.value} onCheckedChange={item.onChange} />
                </div>
              ))}

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1">
                  <span className="text-foreground text-xs">{t('translate.detect.method.label')}</span>
                  <HelpTooltip
                    content={t('translate.detect.method.tip')}
                    iconProps={{ className: 'text-foreground-muted' }}
                  />
                </div>
                <div className="flex items-center gap-0.5 rounded-2xs border border-border/50 bg-card p-0.5">
                  {detectionOptions.map((opt) => (
                    <Tooltip key={opt.value} content={opt.tip} placement="top">
                      <button
                        type="button"
                        onClick={() => setAutoDetectionMethod(opt.value)}
                        className={cn(
                          'rounded-3xs px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
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
                    <span className="text-foreground text-xs">{t('translate.settings.bidirectional')}</span>
                    <HelpTooltip
                      content={t('translate.settings.bidirectional_tip')}
                      iconProps={{ className: 'text-foreground-muted' }}
                    />
                  </div>
                  <Switch size="sm" checked={isBidirectional} onCheckedChange={setIsBidirectional} />
                </div>
                {isBidirectional && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <LanguageSelect
                        style={{ width: '100%' }}
                        value={bidirectionalPair[0].langCode}
                        onChange={(value) =>
                          updateBidirectionalPair([getLanguageByLangcode(value), bidirectionalPair[1]])
                        }
                      />
                    </div>
                    <ArrowLeftRight size={12} className="shrink-0 text-foreground-muted" />
                    <div className="flex-1">
                      <LanguageSelect
                        style={{ width: '100%' }}
                        value={bidirectionalPair[1].langCode}
                        onChange={(value) =>
                          updateBidirectionalPair([bidirectionalPair[0], getLanguageByLangcode(value)])
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-border/40 border-t" />

              <TranslatePromptField />

              <CustomLanguageList />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

const TranslatePromptField: FC = () => {
  const { t } = useTranslation()
  const [persisted, setPersisted] = usePreference('feature.translate.model_prompt')
  const [local, setLocal] = useState<string>(persisted)
  // Tracks a value that has been typed but not yet persisted, so we can flush
  // on unmount (e.g. when the drawer closes before the debounce fires).
  const pendingRef = useRef<string | null>(null)

  useEffect(() => {
    if (local === persisted) {
      pendingRef.current = null
      return
    }
    pendingRef.current = local
    const id = setTimeout(() => {
      void setPersisted(local)
      pendingRef.current = null
    }, 400)
    return () => clearTimeout(id)
  }, [local, persisted, setPersisted])

  useEffect(
    () => () => {
      if (pendingRef.current !== null) {
        void setPersisted(pendingRef.current)
      }
    },
    [setPersisted]
  )

  const isDefault = local === TRANSLATE_PROMPT
  const onReset = () => {
    setLocal(TRANSLATE_PROMPT)
    void setPersisted(TRANSLATE_PROMPT)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-xs">{t('settings.translate.prompt')}</span>
        {!isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="rounded text-[10px] text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {t('common.reset')}
          </button>
        )}
      </div>
      <textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={t('settings.models.translate_model_prompt_message')}
        className="min-h-[120px] w-full resize-y rounded-xs border border-border/30 bg-muted/40 p-3 text-foreground-secondary text-xs leading-relaxed outline-none transition-colors focus:border-border-hover"
      />
    </div>
  )
}

const DEFAULT_LANGUAGE_EMOJI = '🏳️'

const LANGUAGE_EMOJI_OPTIONS: readonly string[] = [
  // Generic symbols
  '🏳️',
  '🌐',
  '🌍',
  '🌎',
  '🌏',
  '💬',
  '🗣️',
  '📖',
  // Flags commonly used for custom languages (not already built-in)
  '🇹🇭',
  '🇻🇳',
  '🇮🇩',
  '🇵🇭',
  '🇲🇾',
  '🇸🇬',
  '🇭🇰',
  '🇹🇼',
  '🇦🇪',
  '🇮🇷',
  '🇮🇱',
  '🇹🇷',
  '🇬🇷',
  '🇧🇷',
  '🇲🇽',
  '🇦🇷',
  '🇺🇸',
  '🇦🇺',
  '🇳🇿',
  '🇮🇳',
  '🇵🇰',
  '🇲🇲',
  '🇰🇭',
  '🇱🇦',
  '🇳🇵',
  '🇿🇦',
  '🇪🇬',
  '🇵🇱',
  '🇨🇿',
  '🇳🇱'
]

const LanguageEmojiPicker: FC<{ value: string; onChange: (emoji: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-3xs border border-border/30 bg-card text-sm leading-none transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {value || DEFAULT_LANGUAGE_EMOJI}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="z-50 w-[248px] rounded-2xs border border-border bg-popover p-2 shadow-md">
        <div className="grid grid-cols-8 gap-0.5">
          {LANGUAGE_EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji)
                setOpen(false)
              }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-3xs text-base leading-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                value === emoji && 'bg-accent'
              )}>
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const CustomLanguageList: FC = () => {
  const { t } = useTranslation()
  const [items, setItems] = useState<CustomTranslateLanguage[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftCode, setDraftCode] = useState('')
  const [draftEmoji, setDraftEmoji] = useState(DEFAULT_LANGUAGE_EMOJI)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let mounted = true
    void getAllCustomLanguages().then((data) => {
      if (mounted) setItems(data)
    })
    return () => {
      mounted = false
    }
  }, [])

  const resetDraft = () => {
    setDraftName('')
    setDraftCode('')
    setDraftEmoji(DEFAULT_LANGUAGE_EMOJI)
  }

  const beginEdit = (item: CustomTranslateLanguage) => {
    setAdding(false)
    setEditingId(item.id)
    setDraftName(item.value)
    setDraftCode(item.langCode)
    setDraftEmoji(item.emoji || DEFAULT_LANGUAGE_EMOJI)
  }

  const cancelEdit = () => {
    setEditingId(null)
    resetDraft()
  }

  const submitEdit = async (item: CustomTranslateLanguage) => {
    const name = draftName.trim()
    const code = draftCode.trim()
    if (!name || !code) {
      cancelEdit()
      return
    }
    try {
      await updateCustomLanguage(item, name, draftEmoji, code)
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, value: name, emoji: draftEmoji, langCode: code.toLowerCase() } : x))
      )
      window.toast.success(t('settings.translate.custom.success.update'))
    } catch (e) {
      window.toast.error(t('settings.translate.custom.error.update') + ': ' + (e as Error).message)
    }
    cancelEdit()
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteCustomLanguage(id)
      setItems((prev) => prev.filter((x) => x.id !== id))
      window.toast.success(t('settings.translate.custom.success.delete'))
    } catch {
      window.toast.error(t('settings.translate.custom.error.delete'))
    }
  }

  const beginAdd = () => {
    setEditingId(null)
    resetDraft()
    setAdding(true)
  }

  const submitAdd = async () => {
    const name = draftName.trim()
    const code = draftCode.trim()
    if (!name || !code) {
      setAdding(false)
      resetDraft()
      return
    }
    try {
      const created = await addCustomLanguage(name, draftEmoji, code)
      setItems((prev) => [...prev, created])
      window.toast.success(t('settings.translate.custom.success.add'))
    } catch (e) {
      window.toast.error(t('settings.translate.custom.error.add') + ': ' + (e as Error).message)
    }
    setAdding(false)
    resetDraft()
  }

  const cancelAdd = () => {
    setAdding(false)
    resetDraft()
  }

  const canSubmit = Boolean(draftName.trim() && draftCode.trim())

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-xs">{t('translate.custom.label')}</span>
        {items.length > 0 && <span className="text-[10px] text-foreground-muted">{items.length}</span>}
      </div>

      {items.map((item) =>
        editingId === item.id ? (
          <div key={item.id} className="flex items-center gap-1.5 rounded-2xs bg-accent/40 px-2 py-1.5">
            <LanguageEmojiPicker value={draftEmoji} onChange={setDraftEmoji} />
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="min-w-0 flex-1 rounded-3xs border border-border/30 bg-card px-2 py-1 text-foreground text-xs outline-none focus:border-border-hover"
              autoFocus
            />
            <input
              value={draftCode}
              onChange={(e) => setDraftCode(e.target.value)}
              className="w-14 shrink-0 rounded-3xs border border-border/30 bg-card px-1.5 py-1 font-mono text-foreground text-xs outline-none focus:border-border-hover"
            />
            <IconButton size="sm" onClick={() => void submitEdit(item)} aria-label={t('common.save')}>
              <Check size={10} />
            </IconButton>
            <IconButton size="sm" onClick={cancelEdit} aria-label={t('common.cancel')}>
              <X size={10} />
            </IconButton>
          </div>
        ) : (
          <div
            key={item.id}
            className="group flex items-center gap-2 rounded-2xs px-2 py-[5px] transition-colors hover:bg-muted">
            <span className="shrink-0 text-sm leading-none">{item.emoji || DEFAULT_LANGUAGE_EMOJI}</span>
            <span className="min-w-0 truncate text-foreground text-xs">{item.value}</span>
            <span className="shrink-0 font-mono text-[10px] text-foreground-muted">{item.langCode}</span>
            <span className="flex-1" />
            <IconButton
              size="xs"
              onClick={() => beginEdit(item)}
              aria-label={t('common.edit')}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <PenLine size={9} />
            </IconButton>
            <IconButton
              size="xs"
              tone="destructive"
              onClick={() => void handleDelete(item.id)}
              aria-label={t('common.delete')}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <X size={9} />
            </IconButton>
          </div>
        )
      )}

      {adding ? (
        <div className="flex items-center gap-1.5 rounded-2xs border border-border/50 border-dashed px-2 py-1.5">
          <LanguageEmojiPicker value={draftEmoji} onChange={setDraftEmoji} />
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="min-w-0 flex-1 rounded-3xs border border-border/30 bg-muted/40 px-2 py-1 text-foreground text-xs outline-none transition-colors placeholder:text-foreground-muted focus:border-border-hover"
            placeholder={t('settings.translate.custom.value.placeholder')}
            autoFocus
          />
          <input
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
            className="w-14 shrink-0 rounded-3xs border border-border/30 bg-muted/40 px-1.5 py-1 font-mono text-foreground text-xs outline-none transition-colors placeholder:text-foreground-muted focus:border-border-hover"
            placeholder={t('settings.translate.custom.langCode.placeholder')}
          />
          <IconButton size="sm" onClick={() => void submitAdd()} disabled={!canSubmit} aria-label={t('common.save')}>
            <Check size={10} />
          </IconButton>
          <IconButton size="sm" onClick={cancelAdd} aria-label={t('common.cancel')}>
            <X size={10} />
          </IconButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={beginAdd}
          className="flex w-full items-center justify-center gap-1 rounded-2xs border border-border/40 border-dashed py-1.5 text-foreground-muted text-xs transition-colors hover:border-border-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Plus size={11} />
          <span>{t('common.add')}</span>
        </button>
      )}
    </div>
  )
}

export default memo(TranslateSettings)
