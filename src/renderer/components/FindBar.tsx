import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ActionIconButton from '@renderer/components/ActionIconButton'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { cn } from '@renderer/utils/style'
import { CaseSensitive, ChevronDown, ChevronUp, User, WholeWord, X } from 'lucide-react'
import type { KeyboardEvent, PropsWithChildren, Ref } from 'react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface FindBarState {
  enabled: boolean
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  includeUser: boolean
}

export const INITIAL_FIND_BAR_STATE: FindBarState = {
  enabled: false,
  query: '',
  caseSensitive: false,
  wholeWord: false,
  includeUser: false
}

export interface FindBarRef {
  disable(): void
  enable(initialText?: string): void
}

interface Props {
  matchCount: number
  currentIndex: number
  onNavigate: (delta: 1 | -1) => void
  onStateChange: (state: FindBarState) => void
  placement?: 'message-list' | 'editor'
  showUserToggle?: boolean
  ref?: Ref<FindBarRef>
}

function EditorPlacement({ children }: PropsWithChildren) {
  const [narrowMode] = usePreference('chat.narrow_mode')

  return (
    <div className="absolute inset-x-0 top-0 z-[999] flex flex-row">
      <NarrowLayout narrowMode={narrowMode} className="w-full">
        {children}
      </NarrowLayout>
      <div className="w-[5px]" />
    </div>
  )
}

export function FindBar({
  matchCount,
  currentIndex,
  onNavigate,
  onStateChange,
  placement = 'message-list',
  showUserToggle = true,
  ref
}: Props) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<FindBarState>(() => ({ ...INITIAL_FIND_BAR_STATE }))
  const [focusSequence, setFocusSequence] = useState(0)

  useEffect(() => {
    onStateChange(state)
  }, [onStateChange, state])

  const focus = useCallback(() => {
    setFocusSequence((sequence) => sequence + 1)
  }, [])

  const disable = useCallback(() => {
    setState((current) => ({ ...current, enabled: false }))
  }, [])

  const enable = useCallback((initialText?: string) => {
    setState((current) => ({
      ...current,
      enabled: true,
      ...(initialText?.trim() ? { query: initialText } : {})
    }))
    setFocusSequence((sequence) => sequence + 1)
  }, [])

  useImperativeHandle(ref, () => ({ disable, enable }), [disable, enable])

  useEffect(() => {
    if (!state.enabled || focusSequence === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSequence, state.enabled])

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        onNavigate(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        disable()
      }
    },
    [disable, onNavigate]
  )

  const updateToggle = useCallback(
    (key: 'caseSensitive' | 'wholeWord' | 'includeUser') => {
      setState((current) => ({ ...current, [key]: !current[key] }))
      focus()
    },
    [focus]
  )

  if (!state.enabled) return null

  const searchBar = (
    <div
      className={cn(
        'z-10 flex items-center justify-center rounded-[10px] border border-primary bg-background px-[15px] py-[5px]',
        placement === 'message-list'
          ? 'absolute top-0 right-5 w-[400px] max-w-[calc(100%-2.5rem)]'
          : 'absolute top-[15px] right-5 left-5 mb-[5px]'
      )}>
      <div className="flex flex-[1_1_auto] items-center">
        <input
          ref={inputRef}
          aria-label={t('chat.assistant.search.placeholder')}
          value={state.query}
          onChange={(event) => setState((current) => ({ ...current, query: event.target.value }))}
          onKeyDown={handleInputKeyDown}
          placeholder={t('chat.assistant.search.placeholder')}
          className="w-full flex-1 border-none bg-transparent px-[5px] py-0 font-[Ubuntu] text-[14px] text-foreground leading-5 outline-none"
        />
        <div className="flex flex-row items-center">
          {showUserToggle && (
            <Tooltip placement="bottom" content={t('button.includes_user_questions')} delay={800}>
              <ActionIconButton
                aria-label={t('button.includes_user_questions')}
                aria-pressed={state.includeUser}
                onClick={() => updateToggle('includeUser')}
                icon={
                  <User size={18} style={{ color: state.includeUser ? 'var(--primary)' : 'var(--muted-foreground)' }} />
                }
              />
            </Tooltip>
          )}
          <Tooltip placement="bottom" content={t('button.case_sensitive')} delay={800}>
            <ActionIconButton
              aria-label={t('button.case_sensitive')}
              aria-pressed={state.caseSensitive}
              onClick={() => updateToggle('caseSensitive')}
              icon={
                <CaseSensitive
                  size={18}
                  style={{ color: state.caseSensitive ? 'var(--primary)' : 'var(--muted-foreground)' }}
                />
              }
            />
          </Tooltip>
          <Tooltip placement="bottom" content={t('button.whole_word')} delay={800}>
            <ActionIconButton
              aria-label={t('button.whole_word')}
              aria-pressed={state.wholeWord}
              onClick={() => updateToggle('wholeWord')}
              icon={
                <WholeWord
                  size={18}
                  style={{ color: state.wholeWord ? 'var(--primary)' : 'var(--muted-foreground)' }}
                />
              }
            />
          </Tooltip>
        </div>
      </div>
      <div className="mx-[2px] h-[1.5em] w-px flex-[0_0_auto] bg-border" />
      <div className="mx-[2px] flex w-20 flex-[0_0_auto] justify-center font-[Ubuntu] text-[14px] text-foreground">
        {matchCount > 0 ? (
          <>
            <span>{currentIndex + 1}</span>
            <span className="mx-1">/</span>
            <span>{matchCount}</span>
          </>
        ) : (
          <span className="opacity-50">0/0</span>
        )}
      </div>
      <div className="flex flex-row items-center">
        <ActionIconButton
          aria-label={t('common.previous')}
          onClick={() => {
            onNavigate(-1)
            focus()
          }}
          disabled={matchCount === 0}
          icon={<ChevronUp size={18} />}
        />
        <ActionIconButton
          aria-label={t('common.next')}
          onClick={() => {
            onNavigate(1)
            focus()
          }}
          disabled={matchCount === 0}
          icon={<ChevronDown size={18} />}
        />
        <ActionIconButton aria-label={t('common.close')} onClick={disable} icon={<X size={18} />} />
      </div>
    </div>
  )

  return placement === 'editor' ? <EditorPlacement>{searchBar}</EditorPlacement> : searchBar
}
