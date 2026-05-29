import { Button, EmptyState, SearchInput } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { isDataApiError } from '@shared/data/api'
import { Menu, Plus } from 'lucide-react'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import MiniAppDisplaySettings from './MiniAppSettings/MiniAppDisplaySettings'
import MiniAppListPair from './MiniAppSettings/MiniAppListPair'
import MiniAppSettingsPanel from './MiniAppSettings/MiniAppSettingsPanel'
import { useMiniAppVisibility } from './MiniAppSettings/useMiniAppVisibility'
import NewMiniAppPanel from './NewMiniAppPanel'

const MiniAppsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newAppOpen, setNewAppOpen] = useState(false)
  const { miniApps, isLoading, error } = useMiniApps()
  const visibility = useMiniAppVisibility()

  const filteredApps = search
    ? miniApps.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : miniApps

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col text-foreground" onContextMenu={handleContextMenu}>
      <Navbar>
        <NavbarCenter className="border-r-0">{t('miniApp.title')}</NavbarCenter>
      </Navbar>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Top-right action buttons */}
        <div className="flex shrink-0 items-start justify-end p-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.miniApps.custom.title')}
              onClick={() => setNewAppOpen(true)}>
              <Plus size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.miniApps.display_title')}
              onClick={() => setSettingsOpen(true)}>
              <Menu size={14} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="-mt-2 px-8">
          <div className="mx-auto max-w-lg">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder={t('common.search')}
              clearLabel={t('common.clear')}
            />
          </div>
        </div>

        {/* Body: loading / error / empty / grid */}
        <Scrollbar className="min-h-0 flex-1 px-8 pb-10">
          <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col">
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <BeatLoader color="var(--color-foreground-secondary)" size={8} />
              </div>
            ) : error ? (
              <div className="flex flex-1 items-center justify-center text-muted-foreground text-xs">
                {isDataApiError(error) ? error.message : t('common.error')}
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  preset={search ? 'no-result' : 'no-miniapp'}
                  title={search ? t('common.no_results') : t('miniApp.title')}
                />
              </div>
            ) : (
              <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(84px,92px))] justify-center gap-x-4 gap-y-8 px-2 pt-12 pb-8 sm:gap-x-5 md:gap-x-6">
                {filteredApps.map((app) => (
                  <App key={app.appId} app={app} size={44} variant="launchpad" />
                ))}
              </div>
            )}
          </div>
        </Scrollbar>

        <MiniAppSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)}>
          {/* Generous gap so the two groups read as distinct, not as one list. */}
          <div className="flex flex-col gap-8">
            <MiniAppListPair {...visibility} />
            <MiniAppDisplaySettings />
          </div>
        </MiniAppSettingsPanel>
        <NewMiniAppPanel open={newAppOpen} onClose={() => setNewAppOpen(false)} />
      </div>
    </div>
  )
}

export default MiniAppsPage
