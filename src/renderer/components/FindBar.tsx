import { CaseSensitive, ChevronDown, ChevronUp, User, WholeWord, X } from 'lucide-react'
import type { KeyboardEvent, PropsWithChildren, Ref, RefObject } from 'react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ActionIconButton from '@renderer/components/ActionIconButton'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { cn } from '@renderer/utils/style'

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

export function FindBarControls({
  inputRef,
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onNavigate,
  onClose,
  status,
  className,
  children
}: PropsWithChildren<{
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  matchCount: number
  currentIndex: number
  onNavigate: (delta: 1 | -1) => void
  onClose: () => void
  status?: string
  className?: string
}>) {
  const { t } = useTranslation()
  const navigate = (delta: 1 | -1) => {
    onNavigate(delta)
    inputRef.current?.focus()
    inputRef.current?.select()
  }
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onNavigate(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      className={cn(
        'z-10 flex min-w-0 flex-wrap items-center justify-center gap-y-1 rounded-[10px] border border-primary bg-background px-[15px] py-[5px]',
        className
      )}>
      <div className="flex min-w-[min(10rem,100%)] flex-1 items-center">
        <input
          ref={inputRef}
          aria-label={t('chat.assistant.search.placeholder')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t('chat.assistant.search.placeholder')}
          className="w-0 min-w-0 flex-1 border-none bg-transparent px-[5px] py-0 font-[Ubuntu] text-[14px] leading-5 text-foreground outline-none"
        />
        {children}
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        <div className="mx-[2px] h-[1.5em] w-px flex-[0_0_auto] bg-border" />
        <div
          role="status"
          title={status}
          className="mx-[2px] flex w-20 flex-[0_0_auto] justify-center font-[Ubuntu] text-[14px] text-foreground tabular-nums">
          {matchCount > 0 ? (
            <>
              <span>{currentIndex + 1}</span>
              <span className="mx-1">/</span>
              <span>{matchCount}</span>
            </>
          ) : (
            <span className="opacity-50">0/0</span>
          )}
          {status && <span className="sr-only"> · {status}</span>}
        </div>
        <ActionIconButton
          aria-label={t('common.previous')}
          onClick={() => navigate(-1)}
          disabled={matchCount === 0}
          icon={<ChevronUp size={18} />}
        />
        <ActionIconButton
          aria-label={t('common.next')}
          onClick={() => navigate(1)}
          disabled={matchCount === 0}
          icon={<ChevronDown size={18} />}
        />
        <ActionIconButton aria-label={t('common.close')} onClick={onClose} icon={<X size={18} />} />
      </div>
    </div>
  )
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

  const updateToggle = useCallback(
    (key: 'caseSensitive' | 'wholeWord' | 'includeUser') => {
      setState((current) => ({ ...current, [key]: !current[key] }))
      focus()
    },
    [focus]
  )

  if (!state.enabled) return null

  const searchBar = (
    <FindBarControls
      inputRef={inputRef}
      query={state.query}
      onQueryChange={(query) => setState((current) => ({ ...current, query }))}
      matchCount={matchCount}
      currentIndex={currentIndex}
      onNavigate={onNavigate}
      onClose={disable}
      className={
        placement === 'message-list'
          ? 'absolute top-0 right-5 w-[400px] max-w-[calc(100%-2.5rem)]'
          : 'absolute top-[15px] right-5 left-5 mb-[5px]'
      }>
      <div className="flex shrink-0 flex-row items-center">
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
              <WholeWord size={18} style={{ color: state.wholeWord ? 'var(--primary)' : 'var(--muted-foreground)' }} />
            }
          />
        </Tooltip>
      </div>
    </FindBarControls>
  )

  return placement === 'editor' ? <EditorPlacement>{searchBar}</EditorPlacement> : searchBar
}
