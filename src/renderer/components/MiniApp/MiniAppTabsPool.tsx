import type { WebviewTag } from 'electron'
import { useCallback, useEffect, useState } from 'react'

import { useCommandContextKey } from '@renderer/hooks/command'
import { useMiniAppRuntime, useMiniAppRuntimeBinding } from '@renderer/hooks/useMiniAppRuntime'
import { ipcApi } from '@renderer/ipc'
import { miniAppWebviewService, type MiniAppResource } from '@renderer/services/MiniAppWebviewService'
import { cn } from '@renderer/utils/style'

import WebviewContainer from './WebviewContainer'

function MiniAppGuest({
  resource,
  secondary,
  split,
  onFocusChange
}: {
  resource: MiniAppResource
  secondary: boolean
  split: boolean
  onFocusChange: (appId: string, focused: boolean) => void
}) {
  const { app, instance, visible, element } = resource
  const bind = useCallback(
    (appId: string, guest: WebviewTag | null) => miniAppWebviewService.bind(appId, instance, guest),
    [instance]
  )
  const loaded = useCallback((appId: string) => miniAppWebviewService.reportLoaded(appId, instance, true), [instance])
  const loading = useCallback((appId: string) => miniAppWebviewService.reportLoaded(appId, instance, false), [instance])
  useEffect(() => {
    if (!element || app.kind !== 'app') return
    void ipcApi.request('mini_app.runtime.set_visible', { appId: app.appId, visible }).catch(() => {})
  }, [app.appId, app.kind, element, visible])
  return (
    <div
      className={cn('absolute top-0 bottom-0 h-full', split ? 'w-1/2' : 'w-full', secondary ? 'left-1/2' : 'left-0')}
      style={{ display: visible ? 'block' : 'none' }}>
      <WebviewContainer
        appid={app.appId}
        url={app.url}
        kind={app.kind}
        onSetRefCallback={bind}
        onLoadedCallback={loaded}
        onLoadingCallback={loading}
        onFocusChange={onFocusChange}
      />
    </div>
  )
}

export default function MiniAppTabsPool() {
  useMiniAppRuntimeBinding()
  const { resources, splitOpen, splitMiniAppId, miniAppShow } = useMiniAppRuntime()
  const [focusedAppId, setFocusedAppId] = useState<string | null>(null)
  const handleFocus = useCallback((id: string, focused: boolean) => {
    setFocusedAppId((current) => (focused ? id : current === id ? null : current))
  }, [])
  useCommandContextKey(
    'webview.focused',
    resources.some((resource) => resource.visible && resource.app.appId === focusedAppId)
  )
  return (
    <div
      data-mini-app-tabs-pool
      aria-hidden={!miniAppShow}
      className="pointer-events-none absolute inset-x-0 top-8.75 bottom-0 z-[1] overflow-hidden rounded-b-md [&_webview]:pointer-events-auto"
      style={{ visibility: miniAppShow ? 'visible' : 'hidden' }}>
      {resources.map((resource) => (
        <MiniAppGuest
          key={resource.instance}
          resource={resource}
          secondary={resource.app.appId === splitMiniAppId}
          split={splitOpen}
          onFocusChange={handleFocus}
        />
      ))}
    </div>
  )
}
