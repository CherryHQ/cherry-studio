import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import MiniAppIcon from '@renderer/components/icons/MiniAppIcon'
import { LaunchpadAppIcon } from '@renderer/components/LaunchpadAppIcon'
import NavbarIcon from '@renderer/components/NavbarIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { useLaunchpadCatalog } from '@renderer/hooks/useLaunchpadCatalog'
import { useMiniApps } from '@renderer/hooks/useMiniApps'

export function MiniLaunchpad({ onOpen }: { onOpen: (url: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (!value) setSearch('')
      }}>
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
        <Input
          aria-label={t('minimal.search_apps')}
          placeholder={t('minimal.search_apps')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <MiniLaunchpadItems
          search={search}
          onOpen={(url) => {
            setOpen(false)
            setSearch('')
            onOpen(url)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function MiniLaunchpadItems({ search, onOpen }: { search: string; onOpen: (url: string) => void }) {
  const { t } = useTranslation()
  const { pinned } = useMiniApps()
  const { apps, shortcuts, miniApps } = useLaunchpadCatalog(pinned)
  const query = search.trim().toLocaleLowerCase()
  const items = [
    ...[...apps, ...shortcuts].map((app) => ({ ...app, icon: <LaunchpadAppIcon src={app.iconSrc} size={40} /> })),
    ...miniApps.map((app) => ({
      id: app.appId,
      url: `/app/mini-app/${app.appId}`,
      label: app.nameKey ? t(app.nameKey) : app.name,
      icon: <MiniAppIcon app={app} appearance="plain" size={40} />
    }))
  ].filter((item) => item.label.toLocaleLowerCase().includes(query))

  return (
    <Scrollbar className="mt-3 max-h-[min(480px,60vh)]">
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('minimal.no_apps')}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
          {items.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className="h-auto min-w-0 flex-col gap-1 px-1 py-2"
              onClick={() => onOpen(item.url)}
              title={item.label}>
              <span className="flex size-[46px] items-center justify-center">{item.icon}</span>
              <span className="w-full truncate text-xs">{item.label}</span>
            </Button>
          ))}
        </div>
      )}
    </Scrollbar>
  )
}
