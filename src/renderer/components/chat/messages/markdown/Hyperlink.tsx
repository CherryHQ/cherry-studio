import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { OgCard } from '@renderer/components/OgCard'
import React, { memo, useMemo, useState } from 'react'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
}

const HYPERLINK_CARD_OPEN_DELAY = 1500
const HYPERLINK_CARD_CLOSE_DELAY = 100

const Hyperlink: React.FC<HyperLinkProps> = ({ children, href }) => {
  const [open, setOpen] = useState(false)

  const link = useMemo(() => {
    try {
      return decodeURIComponent(href)
    } catch {
      return href
    }
  }, [href])

  if (!href) return children

  return (
    <HoverCard openDelay={HYPERLINK_CARD_OPEN_DELAY} closeDelay={HYPERLINK_CARD_CLOSE_DELAY} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <span className="inline">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-none overflow-hidden rounded-lg p-0" sideOffset={0}>
        <OgCard link={link} show={open} />
      </HoverCardContent>
    </HoverCard>
  )
}

export default memo(Hyperlink)
