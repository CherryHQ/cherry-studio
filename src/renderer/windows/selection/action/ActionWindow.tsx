import { Button, Slider, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import i18n from '@renderer/i18n'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { Droplet, Minus, Pin, X } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import type { ComponentProps, FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ActionGeneral from './components/ActionGeneral'
import ActionTranslate from './components/ActionTranslate'

/**
 * Outer shell. Pulls the current action payload via `useWindowInitData`, which
 * transparently handles both cold-start (pooled warmup / first mount) and
 * reuse (`window.reused` payload on pool recycle). No `key={resetKey}`
 * remount — `SelectionActionContent` stays mounted across recycles and
 * receives `action` as a prop. Per-action state is reset in a single
 * `useEffect([action])` inside the content component.
 */
const ActionWindow: FC = () => {
  const action = useWindowInitData<SelectionActionItem>()
  if (!action) return null
  return <SelectionActionContent action={action} />
}

/**
 * Controlled content component. All selection-action UI state lives here;
 * `action` is supplied by the parent and updated on every pool recycle /
 * singleton re-use without unmounting. A consolidated `useEffect([action])`
 * (keyed on the reference, not `.id`) resets per-session state (pin, opacity,
 * slider, scroll) so old state doesn't bleed into the new session, even when
 * the next action happens to be the same type as the previous one.
 */
const SelectionActionContent: FC<{ action: SelectionActionItem }> = ({ action }) => {
  const [language] = usePreference('app.language')
  const [customCss] = usePreference('ui.custom_css')
  const { t } = useTranslation()

  const [isAutoClose] = usePreference('feature.selection.auto_close')
  const [isAutoPin] = usePreference('feature.selection.auto_pin')
  const [actionWindowOpacity] = usePreference('feature.selection.action_window_opacity')

  const [isPinned, setIsPinned] = useState(isAutoPin)
  const [isWindowFocus, setIsWindowFocus] = useState(true)

  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [opacity, setOpacity] = useState(actionWindowOpacity)

  const shouldCloseWhenBlur = useRef(false)
  const contentElementRef = useRef<HTMLDivElement>(null)
  const isAutoScrollEnabled = useRef(true)
  const lastScrollHeight = useRef(0)

  useEffect(() => {
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
    }
    // don't need any dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Per-session reset: must fire on EVERY reuse, even when the next action
  // has the same id as the previous one (e.g. two consecutive `translate`
  // invocations). The right signal is the `action` reference itself — main
  // sends a fresh IPC-deserialized object on every Reused push, so
  // `Object.is`-based effect deps change each time. Using `[action.id]` here
  // would leak stale pin/opacity/slider/scroll state across same-type reuses.
  useEffect(() => {
    setIsPinned(isAutoPin)
    void ipcApi.request('selection.pin_action_window', isAutoPin)
    setOpacity(actionWindowOpacity)
    setShowOpacitySlider(false)
    isAutoScrollEnabled.current = true
    contentElementRef.current?.scrollTo({ top: 0 })
    lastScrollHeight.current = contentElementRef.current?.scrollHeight ?? 0
    // Only re-run on action change; `isAutoPin` / `actionWindowOpacity` are
    // handled separately by their own effects when the preference itself moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  useEffect(() => {
    if (isAutoPin) {
      void ipcApi.request('selection.pin_action_window', true)
      setIsPinned(true)
    } else {
      void ipcApi.request('selection.pin_action_window', false)
      setIsPinned(false)
    }
  }, [isAutoPin])

  useEffect(() => {
    shouldCloseWhenBlur.current = isAutoClose && !isPinned
  }, [isAutoClose, isPinned])

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  useEffect(() => {
    // Register the scroll listener exactly once on mount. The content DOM node
    // does not change across pool reuses (we never unmount), and
    // `handleUserScroll` only reads from refs, so a single subscription is
    // sufficient; per-session scrollTop / lastScrollHeight reset lives in the
    // `[action]` reset effect above.
    const contentEl = contentElementRef.current
    if (contentEl) {
      contentEl.addEventListener('scroll', handleUserScroll)
      lastScrollHeight.current = contentEl.scrollHeight
    }
    return () => {
      if (contentEl) {
        contentEl.removeEventListener('scroll', handleUserScroll)
      }
    }
  }, [])

  useEffect(() => {
    document.title = `${action.isBuiltIn ? t(action.name) : action.name} - ${t('selection.name')}`
  }, [action.id, action.isBuiltIn, action.name, t])

  useEffect(() => {
    setOpacity(actionWindowOpacity)
  }, [actionWindowOpacity])

  const handleMinimize = () => {
    void ipcApi.request('window.minimize')
  }

  const handleClose = () => {
    void ipcApi.request('window.close')
  }

  /**
   * @param pinned - if undefined, toggle the pinned state, otherwise force set the pinned state
   */
  const togglePin = () => {
    setIsPinned(!isPinned)
    void ipcApi.request('selection.pin_action_window', !isPinned)
  }

  const handleWindowFocus = () => {
    setIsWindowFocus(true)
  }

  const handleWindowBlur = () => {
    if (shouldCloseWhenBlur.current) {
      handleClose()
      return
    }

    setIsWindowFocus(false)
  }

  const handleOpacityChange = (value: number[]) => {
    const nextOpacity = value[0]
    if (typeof nextOpacity === 'number') {
      setOpacity(nextOpacity)
    }
  }

  //must useCallback to avoid re-rendering the component
  const handleScrollToBottom = useCallback(() => {
    if (contentElementRef.current && isAutoScrollEnabled.current) {
      contentElementRef.current.scrollTo({
        top: contentElementRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [])

  const handleUserScroll = () => {
    if (!contentElementRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = contentElementRef.current

    // Check if content height has increased (new content added)
    const contentIncreased = scrollHeight > lastScrollHeight.current
    lastScrollHeight.current = scrollHeight

    // If content increased and we're in auto-scroll mode, don't change the auto-scroll state
    if (contentIncreased && isAutoScrollEnabled.current) {
      return
    }

    // Only check user position if content didn't increase
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 32

    if (isAtBottom) {
      isAutoScrollEnabled.current = true
    } else {
      isAutoScrollEnabled.current = false
    }
  }

  return (
    <div
      className="relative m-0.5 flex h-[calc(100%-6px)] w-[calc(100%-6px)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-[0_0_2px_var(--color-border)]"
      style={{ opacity: opacity / 100 }}>
      <div
        className={cn(
          'flex h-8 flex-row items-center px-2 transition-colors duration-300 [-webkit-app-region:drag]',
          isWindowFocus ? 'bg-muted' : 'bg-secondary'
        )}
        style={isMac ? { paddingLeft: '70px' } : {}}>
        {action.icon && (
          <div className="ml-1 flex items-center justify-center">
            <DynamicIcon name={action.icon as any} size={16} className="text-foreground" fallback={() => {}} />
          </div>
        )}
        <div className="ml-2 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-foreground text-sm">
          {action.isBuiltIn ? t(action.name) : action.name}
        </div>
        <div className="relative flex gap-2 [-webkit-app-region:no-drag]">
          <Tooltip
            content={isPinned ? t('selection.action.window.pinned') : t('selection.action.window.pin')}
            placement="bottom">
            <WindowButton
              onClick={togglePin}
              className={isPinned ? 'bg-primary/10 text-primary hover:bg-primary/10' : ''}>
              <Pin
                size={14}
                className={isPinned ? 'rotate-45 text-primary transition-transform' : 'transition-transform'}
              />
            </WindowButton>
          </Tooltip>
          <Tooltip
            content={t('selection.action.window.opacity')}
            placement="bottom"
            isOpen={showOpacitySlider ? false : undefined}>
            <WindowButton
              onClick={() => setShowOpacitySlider(!showOpacitySlider)}
              className={showOpacitySlider ? 'bg-primary/10 text-primary hover:bg-primary/10' : 'pb-0.5'}>
              <Droplet size={14} />
            </WindowButton>
          </Tooltip>
          {showOpacitySlider && (
            <div className="absolute top-full left-10 z-[80] mt-2 flex h-[120px] items-center justify-center rounded bg-popover px-2 pt-4 pb-3 opacity-100! shadow-md">
              <Slider
                orientation="vertical"
                min={20}
                max={100}
                value={[opacity]}
                onValueChange={handleOpacityChange}
                onValueCommit={() => setShowOpacitySlider(false)}
                showValueLabel
                formatValueLabel={(value) => `${value}%`}
              />
            </div>
          )}
          {!isMac && (
            <>
              <WindowButton onClick={handleMinimize}>
                <Minus size={16} />
              </WindowButton>
              <WindowButton onClick={handleClose} className="hover:bg-error-base hover:text-white">
                <X size={16} />
              </WindowButton>
            </>
          )}
        </div>
      </div>
      <div className="flex h-full w-full justify-center overflow-auto">
        <div
          ref={contentElementRef}
          className="flex max-w-[1280px] flex-1 select-text flex-col overflow-auto p-4 text-sm [-webkit-app-region:no-drag]">
          {action.id == 'translate' && <ActionTranslate action={action} scrollToBottom={handleScrollToBottom} />}
          {action.id != 'translate' && <ActionGeneral action={action} scrollToBottom={handleScrollToBottom} />}
        </div>
      </div>
    </div>
  )
}

const WindowButton: FC<ComponentProps<typeof Button>> = ({ className, ...props }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    className={cn(
      'size-6 rounded border-0 bg-transparent p-0 text-icon shadow-none transition-colors hover:bg-accent hover:text-accent-foreground',
      className
    )}
    {...props}
  />
)

export default ActionWindow
