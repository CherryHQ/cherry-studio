import { Button, EmptyState, SearchInput, Tooltip } from '@cherrystudio/ui'
import App from '@renderer/components/MiniApp/MiniApp'
import { Navbar, NavbarCenter } from '@renderer/components/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { isDataApiError } from '@shared/data/api/errors'
import type { MiniApp } from '@shared/data/types/miniApp'
import { Menu, Plus } from 'lucide-react'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import InstallMiniAppPanel from './InstallMiniAppPanel'
import MiniAppDisplaySettings from './MiniAppSettings/MiniAppDisplaySettings'
import MiniAppListPair from './MiniAppSettings/MiniAppListPair'
import MiniAppSettingsPanel from './MiniAppSettings/MiniAppSettingsPanel'
import { useMiniAppVisibility } from './MiniAppSettings/useMiniAppVisibility'
import NewMiniAppPanel from './NewMiniAppPanel'
import { useBuiltinMiniApps } from './useBuiltinMiniApps'

const MINI_APPS_LOADING_COLOR = 'var(--muted-foreground)'

const MiniAppsPage: FC = () => {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newAppOpen, setNewAppOpen] = useState(false)
  // Non-null mounts the consent dialog for that builtin app; the toolbar has no install entry.
  const [install, setInstall] = useState<{ builtinAppId: string } | null>(null)
  const [editingApp, setEditingApp] = useState<MiniApp | null>(null)
  const { appEdition, allApps, miniApps, isLoading, error } = useMiniApps()
  const visibility = useMiniAppVisibility()
  // EVERY row, not `miniApps`: a disabled official app is still installed.
  const builtinApps = useBuiltinMiniApps(allApps, i18n.language)

  const filteredApps = search
    ? miniApps.filter(
        (app) => app.name.toLowerCase().includes(search.toLowerCase()) || app.url.includes(search.toLowerCase())
      )
    : miniApps
  const filteredBuiltins = search
    ? builtinApps.filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase()))
    : builtinApps

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const closeCustomAppPanel = () => {
    setNewAppOpen(false)
    setEditingApp(null)
  }

  return (
    <div
      data-ui="mini-apps.view"
      className="flex h-full min-h-0 flex-1 flex-col text-foreground"
      onContextMenu={handleContextMenu}>
      <Navbar>
        <NavbarCenter className="border-r-0">{t('miniApp.title')}</NavbarCenter>
      </Navbar>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Top-right action buttons */}
        <div className="flex shrink-0 items-start justify-end p-3">
          <div className="flex items-center gap-1">
            <Tooltip content={t('miniApp.add.title')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('miniApp.add.title')}
                onClick={() => {
                  setEditingApp(null)
                  setNewAppOpen(true)
                }}>
                <Plus size={14} />
              </Button>
            </Tooltip>
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
                <BeatLoader color={MINI_APPS_LOADING_COLOR} size={8} />
              </div>
            ) : error ? (
              <div className="flex flex-1 items-center justify-center text-muted-foreground text-xs">
                {isDataApiError(error) ? error.message : t('common.error')}
              </div>
            ) : filteredApps.length === 0 && filteredBuiltins.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  preset={search ? 'no-result' : 'no-miniapp'}
                  title={search ? t('common.no_results') : t('miniApp.title')}
                />
              </div>
            ) : (
              <>
                {filteredApps.length > 0 && (
                  <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(84px,92px))] justify-center gap-x-4 gap-y-8 px-2 pt-12 pb-8 sm:gap-x-5 md:gap-x-6">
                    {filteredApps.map((app) => (
                      <App key={app.appId} app={app} size={56} variant="launchpad" onEditCustom={setEditingApp} />
                    ))}
                  </div>
                )}
                {/* Shipped but not installed: a click opens consent, never a tab (no files on disk yet). */}
                {filteredBuiltins.length > 0 && (
                  <section className="flex flex-col gap-6 px-2 pt-8 pb-8">
                    <h2 className="text-center font-medium text-muted-foreground text-xs">
                      {t('miniApp.builtin.not_installed')}
                    </h2>
                    <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(84px,92px))] justify-center gap-x-4 gap-y-8 sm:gap-x-5 md:gap-x-6">
                      {filteredBuiltins.map((entry) => (
                        <button
                          key={entry.appId}
                          type="button"
                          className="flex min-h-[104px] w-[92px] cursor-pointer flex-col items-center pt-1 outline-none hover:[&_.mini-app-icon-frame]:bg-accent focus-visible:[&_.mini-app-icon-frame]:border-ring focus-visible:[&_.mini-app-icon-frame]:bg-accent"
                          onClick={() => setInstall({ builtinAppId: entry.appId })}>
                          <span className="mini-app-icon-frame flex size-[58px] items-center justify-center overflow-hidden rounded-[14px] border border-border-subtle transition-[border-color,background-color] duration-[160ms] ease-in-out motion-reduce:transition-none">
                            <img src={entry.iconUrl} alt="" className="size-14 rounded-[inherit]" />
                          </span>
                          <span className="mt-2 min-h-9 max-w-[92px] select-none overflow-hidden whitespace-normal text-center text-[13px] text-muted-foreground leading-[18px] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [overflow-wrap:anywhere]">
                            {entry.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </Scrollbar>

        <MiniAppSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)}>
          {/* Generous gap so the two groups read as distinct, not as one list. */}
          <div className="flex flex-col gap-8">
            <MiniAppListPair {...visibility} />
            <MiniAppDisplaySettings appEdition={appEdition} />
          </div>
        </MiniAppSettingsPanel>
        <NewMiniAppPanel open={newAppOpen || editingApp != null} app={editingApp} onClose={closeCustomAppPanel} />
        {/* Mounted only while open: unmounting is one of the panel's cancel paths. */}
        {install && <InstallMiniAppPanel builtinAppId={install.builtinAppId} onClose={() => setInstall(null)} />}
      </div>
    </div>
  )
}

export default MiniAppsPage
