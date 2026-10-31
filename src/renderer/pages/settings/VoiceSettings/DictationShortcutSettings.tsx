import { CircleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDescription,
  SettingDivider,
  SettingRow,
  SettingRowTitle
} from '@renderer/components/SettingsPrimitives'
import { useCommandContextSnapshot, useCommandShortcutPreferences } from '@renderer/hooks/command'
import {
  dictationShortcutsConflict,
  formatDictationShortcut,
  getDictationShortcutBinding,
  hasDictationCommandConflict,
  parseDictationShortcut
} from '@renderer/utils/dictationShortcut'
import { isMac, isWin } from '@renderer/utils/platform'
import { getShortcutBindingFromKeyboardEvent, isShortcutModifier } from '@shared/utils/shortcut'

function ShortcutRow({ mode }: { mode: 'hold' | 'toggle' }) {
  const { t } = useTranslation()
  const platform = isMac ? 'darwin' : isWin ? 'win32' : 'linux'
  const [value, setValue] = usePreference(`feature.voice.dictation.${mode}_shortcut`)
  const [other] = usePreference(`feature.voice.dictation.${mode === 'hold' ? 'toggle' : 'hold'}_shortcut`)
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState('')
  const [error, setError] = useState<'conflict' | 'invalid' | 'save_failed'>()
  const preferences = useCommandShortcutPreferences()
  const commandContext = new Map(useCommandContextSnapshot())
    .set('chat.active', true)
    .set('topic.exists', true)
    .set('input.composing', false)
    .set('webview.focused', false)
  const pressed = useRef(new Set<string>())
  useEffect(() => {
    if (!recording) return
    const cancel = () => {
      pressed.current.clear()
      setRecording(false)
    }
    const visibility = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [recording])
  const label = t(mode === 'hold' ? 'settings.voice.shortcuts.hold.label' : 'settings.voice.shortcuts.toggle.label')
  const display = (binding: string) =>
    formatDictationShortcut(binding, isMac, t('settings.voice.shortcuts.left'), t('settings.voice.shortcuts.right'))
  return (
    <SettingRow id={`setting-voice-dictation-${mode}`} className="scroll-mt-6 flex-wrap gap-3">
      <div className="flex flex-col gap-1">
        <SettingRowTitle className="gap-1.5">
          {label}
          <Tooltip content={t('settings.voice.shortcuts.rules')} asChild>
            <span
              role="img"
              tabIndex={0}
              aria-label={t('settings.voice.shortcuts.rules')}
              className="text-muted-foreground inline-flex shrink-0 rounded-sm outline-none focus-visible:bg-accent">
              <CircleAlert size={14} aria-hidden="true" />
            </span>
          </Tooltip>
        </SettingRowTitle>
        <SettingDescription>
          {t(
            mode === 'hold'
              ? 'settings.voice.shortcuts.hold.description'
              : 'settings.voice.shortcuts.toggle.description'
          )}
        </SettingDescription>
        {error && (
          <span role="alert" className="text-error">
            {t(
              error === 'conflict'
                ? 'settings.voice.shortcuts.conflict'
                : error === 'invalid'
                  ? 'settings.voice.shortcuts.rules'
                  : 'settings.voice.shortcuts.save_failed'
            )}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          className="w-full justify-start sm:w-64"
          aria-label={label}
          aria-pressed={recording}
          onClick={() => {
            pressed.current.clear()
            setPending('')
            setError(undefined)
            setRecording(true)
          }}
          onBlur={() => {
            pressed.current.clear()
            setRecording(false)
          }}
          onKeyDown={(event) => {
            if (!recording) return
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape') {
              setRecording(false)
              return
            }
            if (event.repeat) return
            pressed.current.add(event.code)
            setPending([...pressed.current].sort().join('+'))
          }}
          onKeyUp={(event) => {
            if (!recording || !pressed.current.has(event.code)) return
            event.preventDefault()
            event.stopPropagation()
            const candidate = parseDictationShortcut([...pressed.current].join('+')).join('+')
            pressed.current.delete(event.code)
            const eventBinding = getShortcutBindingFromKeyboardEvent(event, platform)
            const lostModifier = getDictationShortcutBinding([...pressed.current].join('+'), platform)
              .filter(isShortcutModifier)
              .some((modifier) => !eventBinding.includes(modifier))
            if (!candidate || lostModifier) {
              setError('invalid')
              setRecording(false)
              return
            }
            const commandConflict = hasDictationCommandConflict(candidate, {
              preferences,
              context: commandContext,
              platform
            })
            const pairConflict =
              mode === 'hold'
                ? dictationShortcutsConflict(candidate, other)
                : dictationShortcutsConflict(other, candidate)
            if (pairConflict || commandConflict) {
              setError('conflict')
              setRecording(false)
              return
            }
            void setValue(candidate).catch(() => setError('save_failed'))
            setRecording(false)
          }}>
          {recording
            ? display(pending) || t('settings.voice.shortcuts.record')
            : display(value) || t('settings.voice.shortcuts.unset')}
        </Button>
        {value && (
          <Tooltip content={t('settings.voice.shortcuts.clear', { name: label })}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.voice.shortcuts.clear', { name: label })}
              onClick={() => void setValue('').catch(() => setError('save_failed'))}>
              <X className="size-4" />
            </Button>
          </Tooltip>
        )}
      </div>
    </SettingRow>
  )
}

export function DictationShortcutSettings() {
  const { t } = useTranslation()
  const [mouseHold, setMouseHold] = usePreference('feature.voice.dictation.mouse_hold_enabled')
  const [saveFailed, setSaveFailed] = useState(false)
  return (
    <>
      <SettingRow id="setting-voice-dictation-mouse-hold" className="scroll-mt-6 flex-wrap gap-3">
        <div>
          <SettingRowTitle>{t('settings.voice.mouse_hold.label')}</SettingRowTitle>
          <SettingDescription>{t('settings.voice.mouse_hold.description')}</SettingDescription>
          {saveFailed && (
            <span role="alert" className="text-error">
              {t('settings.voice.shortcuts.save_failed')}
            </span>
          )}
        </div>
        <Switch
          aria-label={t('settings.voice.mouse_hold.label')}
          checked={mouseHold}
          onCheckedChange={(value) => {
            setSaveFailed(false)
            void setMouseHold(value).catch(() => setSaveFailed(true))
          }}
        />
      </SettingRow>
      <SettingDivider />
      <ShortcutRow mode="hold" />
      <SettingDivider />
      <ShortcutRow mode="toggle" />
    </>
  )
}
