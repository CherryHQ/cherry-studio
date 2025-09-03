import { OGCard } from '@renderer/components/OGCard'
import { Popover } from 'antd'
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
    <Popover
      arrow={false}
      open={open}
      onOpenChange={setOpen}
      content={<OGCard link={link} show={open} />}
      placement="top"
      styles={{
        body: {
          padding: 0,
          borderRadius: '8px',
          overflow: 'hidden'
        }
      }}>
      {children}
    </Popover>
  )
}

export default memo(Hyperlink)
