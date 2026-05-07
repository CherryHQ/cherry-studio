import { Button, EmptyState, Input } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import App from '@renderer/components/MiniApp/MiniApp'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { isDataApiError } from '@shared/data/api'
import { ArrowLeftRight, LayoutGrid, Menu, Plus, RotateCcw, Search, X } from 'lucide-react'
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
        {/* Title row + top-right action buttons */}
        <div className="flex h-11 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-1.5 text-xs">
            <LayoutGrid size={13} className="text-muted-foreground" strokeWidth={1.6} />
            <span className="text-foreground">{t('miniApp.title')}</span>
            <span className="ml-1 text-[10px] text-muted-foreground/40">{filteredApps.length}</span>
          </div>
          <div className="flex items-center gap-0.5">
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
        <div className="px-6 py-2">
          <div className="relative mx-auto max-w-md">
            <Search size={13} className="-translate-y-1/2 absolute top-1/2 left-3 z-10 text-muted-foreground/40" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="h-auto rounded-3xs border-border/50 bg-muted/20 py-1.5 pr-7 pl-8 text-xs shadow-none placeholder:text-muted-foreground/30 focus-visible:border-primary/30 focus-visible:ring-0"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSearch('')}
                aria-label={t('common.clear')}
                className="-translate-y-1/2 absolute top-1/2 right-1 text-muted-foreground shadow-none hover:text-foreground">
                <X size={12} />
              </Button>
            )}
          </div>
        </div>

        {/* Body: loading / error / empty / grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-3xl space-y-5">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <BeatLoader color="var(--color-text-2)" size={8} />
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                {isDataApiError(error) ? error.message : t('common.error')}
              </div>
            ) : filteredApps.length === 0 ? (
              <EmptyState
                preset={search ? 'no-result' : 'no-miniapp'}
                title={search ? t('common.no_results') : t('miniApp.title')}
              />
            ) : (
              <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8">
                {filteredApps.map((app) => (
                  <App key={app.appId} app={app} size={44} />
                ))}
              </div>
            )}
          </div>
        </div>

        <MiniAppSettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          headerActions={
            <>
              <Button variant="ghost" size="sm" onClick={visibility.swap} className="gap-1 text-[11px]">
                <ArrowLeftRight size={12} />
                {t('common.swap')}
              </Button>
              <Button variant="ghost" size="sm" onClick={visibility.reset} className="gap-1 text-[11px]">
                <RotateCcw size={12} />
                {t('common.reset')}
              </Button>
            </>
          }>
          <MiniAppListPair {...visibility} />
          <MiniAppDisplaySettings />
        </MiniAppSettingsPanel>
        <NewMiniAppPanel open={newAppOpen} onClose={() => setNewAppOpen(false)} />
      </div>
    </div>
  )
}

export default MiniAppsPage
