import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { OGCard } from '@renderer/components/OGCard'
import React, { memo, useMemo, useState } from 'react'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
}

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="overflow-hidden rounded-lg p-0">
        <OGCard link={link} show={open} />
      </PopoverContent>
    </Popover>
  )
}

export default memo(Hyperlink)
