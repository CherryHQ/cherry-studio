import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { OGCard } from '@renderer/components/OGCard'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
}

const Hyperlink: React.FC<HyperLinkProps> = ({ children, href }) => {
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const link = useMemo(() => {
    try {
      return decodeURIComponent(href)
    } catch {
      return href
    }
  }, [href])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const openPopover = useCallback(() => {
    clearCloseTimer()
    setOpen(true)
  }, [clearCloseTimer])

  const closePopover = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      setOpen(false)
      closeTimerRef.current = null
    }, 100)
  }, [clearCloseTimer])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  if (!href) return children

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="inline" onMouseEnter={openPopover} onMouseLeave={closePopover}>
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent className="overflow-hidden rounded-lg p-0" onMouseEnter={openPopover} onMouseLeave={closePopover}>
        <OGCard link={link} show={open} />
      </PopoverContent>
    </Popover>
  )
}

export default memo(Hyperlink)
