import React, { memo, useMemo, useRef, useState } from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { OgCard } from '@renderer/components/OgCard'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
  onOpenLink?: (url: string) => void | Promise<void>
}

const HYPERLINK_CARD_OPEN_DELAY = 500
const HYPERLINK_CARD_CLOSE_DELAY = 100

const Hyperlink: React.FC<HyperLinkProps> = ({ children, href, onOpenLink }) => {
  const [open, setOpen] = useState(false)
  const contextMenuRequested = useRef(false)
  const dismissPreview = () => {
    contextMenuRequested.current = true
    setOpen(false)
  }

  const link = useMemo(() => {
    try {
      return decodeURIComponent(href)
    } catch {
      return href
    }
  }, [href])

  if (!href) return children

  return (
    <HoverCard
      open={open}
      openDelay={HYPERLINK_CARD_OPEN_DELAY}
      closeDelay={HYPERLINK_CARD_CLOSE_DELAY}
      onOpenChange={(nextOpen) => setOpen(nextOpen && !contextMenuRequested.current)}>
      <HoverCardTrigger asChild>
        <span
          className="inline"
          onPointerEnter={() => {
            contextMenuRequested.current = false
          }}
          onPointerDown={(event) => {
            if (event.button === 2) dismissPreview()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab') contextMenuRequested.current = false
          }}
          onContextMenu={dismissPreview}>
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-auto max-w-none overflow-hidden rounded-lg p-0"
        sideOffset={0}
        onClick={(event) => {
          if (
            !onOpenLink ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            !(event.target instanceof Element && event.target.closest('a[href]'))
          )
            return
          event.preventDefault()
          event.stopPropagation()
          void onOpenLink(href)
        }}>
        <OgCard link={link} show={open} />
      </HoverCardContent>
    </HoverCard>
  )
}

export default memo(Hyperlink)
