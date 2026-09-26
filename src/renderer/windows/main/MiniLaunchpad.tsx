import { Plus } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'

const LaunchpadContent = lazy(() =>
  import('@renderer/components/LaunchpadContent').then((module) => ({ default: module.LaunchpadContent }))
)

export function MiniLaunchpad({ onOpen }: { onOpen: (url: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={t('title.launchpad')} isOpen={open ? false : undefined}>
        <PopoverTrigger asChild>
          <NavbarIcon tone="conversation" aria-label={t('title.launchpad')}>
            <Plus strokeWidth={1.7} />
          </NavbarIcon>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-[600px] max-w-[calc(100vw-24px)] p-4"
        aria-label={t('title.launchpad')}>
        <Suspense fallback={null}>
          <LaunchpadContent
            compact
            onOpen={(url) => {
              setOpen(false)
              onOpen(url)
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
