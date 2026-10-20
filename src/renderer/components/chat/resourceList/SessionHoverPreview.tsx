import {
  createContext,
  type ReactElement,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'

type PreviewGroup = {
  activeId: string | null
  enter: (id: string) => void
  leave: (id: string) => void
  change: (id: string, open: boolean) => void
  remove: (id: string) => void
  contextMenuChange: (id: string, open: boolean) => void
}

const PreviewContext = createContext<PreviewGroup | null>(null)

export function SessionHoverPreviewGroup({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const contextMenus = useRef(new Set<string>())
  const warm = useRef(false)
  const candidate = useRef<string | null>(null)
  const reset = useCallback(() => {
    warm.current = false
    candidate.current = null
    setActiveId(null)
  }, [])
  const contextMenuChange = useCallback(
    (id: string, open: boolean) => {
      if (open) contextMenus.current.add(id)
      else if (!contextMenus.current.delete(id)) return
      reset()
    },
    [reset]
  )
  const remove = useCallback((id: string) => {
    if (candidate.current === id) candidate.current = null
    setActiveId((current) => (current === id ? null : current))
  }, [])

  useEffect(() => {
    if (!enabled) reset()
  }, [enabled, reset])
  useEffect(() => {
    // Hovering a title does not move keyboard focus out of the message editor.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset()
    }
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
      reset()
    }
  }, [reset])

  const group = useMemo<PreviewGroup>(
    () => ({
      activeId: enabled ? activeId : null,
      enter(id) {
        if (!enabled || contextMenus.current.size > 0) return
        candidate.current = id
        if (activeId === id) warm.current = true
        if (warm.current) setActiveId(id)
      },
      leave(id) {
        if (candidate.current === id) candidate.current = null
      },
      change(id, open) {
        if (open) {
          // Ignore delayed opens after scrolling, dismissal, or moving to another row.
          if (!enabled || contextMenus.current.size > 0 || candidate.current !== id) return
          warm.current = true
          setActiveId(id)
        } else {
          setActiveId((current) => (current === id ? null : current))
        }
      },
      remove,
      contextMenuChange
    }),
    [activeId, enabled, remove, contextMenuChange]
  )

  return (
    <PreviewContext value={group}>
      <div
        className="contents"
        onPointerLeave={() => {
          warm.current = false
        }}
        onScrollCapture={reset}
        onPointerDownCapture={(event) => {
          if (!(event.target instanceof Element && event.target.closest('[data-slot="hover-card-content"]'))) reset()
        }}>
        {children}
      </div>
    </PreviewContext>
  )
}

export function useSessionHoverPreviewContextMenu(id: string) {
  const contextMenuChange = use(PreviewContext)?.contextMenuChange
  useEffect(() => () => contextMenuChange?.(id, false), [contextMenuChange, id])
  return useCallback((open: boolean) => contextMenuChange?.(id, open), [contextMenuChange, id])
}

export function SessionHoverPreview({
  id,
  content,
  children
}: {
  id: string
  content: ReactNode
  children: ReactElement
}) {
  const group = use(PreviewContext)
  if (!group) throw new Error('SessionHoverPreview requires SessionHoverPreviewGroup')
  const { remove } = group
  useEffect(() => () => remove(id), [id, remove])
  const open = group.activeId === id

  return (
    <HoverCard open={open} onOpenChange={(next) => group.change(id, next)} openDelay={500} closeDelay={100}>
      <HoverCardTrigger
        asChild
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') group.enter(id)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') group.leave(id)
        }}>
        {children}
      </HoverCardTrigger>
      {open && (
        <HoverCardContent
          side="right"
          sideOffset={4}
          className="w-auto max-w-80 animate-none! p-3 text-xs break-words"
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') group.enter(id)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') group.leave(id)
          }}
          onClick={(event) => event.stopPropagation()}>
          {content}
        </HoverCardContent>
      )}
    </HoverCard>
  )
}
