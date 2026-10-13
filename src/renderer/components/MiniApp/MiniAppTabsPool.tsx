import type { WebviewTag } from 'electron'
import { useCallback, useEffect, useState } from 'react'

import { useCommandContextKey } from '@renderer/hooks/command'
import { useMiniAppRuntime, useMiniAppRuntimeBinding } from '@renderer/hooks/useMiniAppRuntime'
import { ipcApi } from '@renderer/ipc'
import { webviewRuntimeService, type WebviewResource } from '@renderer/services/WebviewRuntimeService'
import { cn } from '@renderer/utils/style'

import WebviewContainer from './WebviewContainer'

function MiniAppGuest({
  resource,
  secondary,
  split,
  onFocusChange
}: {
  resource: WebviewResource
  secondary: boolean
  split: boolean
  onFocusChange: (appId: string, focused: boolean) => void
}) {
  const { key, source, instance, visible, element } = resource
  const appId = key.slice('miniapp:'.length)
  const kind = source.partition === 'persist:webview' ? 'site' : 'app'
  const bind = useCallback(
    (_appId: string, guest: WebviewTag | null) => webviewRuntimeService.bind(key, instance, guest),
    [key, instance]
  )
  const loaded = useCallback(() => webviewRuntimeService.reportLoaded(key, instance, true), [key, instance])
  const loading = useCallback(() => webviewRuntimeService.reportLoaded(key, instance, false), [key, instance])
  useEffect(() => {
    if (!element || kind !== 'app') return
    void ipcApi.request('mini_app.runtime.set_visible', { appId: appId, visible }).catch(() => {})
  }, [appId, kind, element, visible])
  return (
    <div
      className={cn('absolute top-0 bottom-0 h-full', split ? 'w-1/2' : 'w-full', secondary ? 'left-1/2' : 'left-0')}
      style={{ display: visible ? 'block' : 'none' }}>
      <WebviewContainer
        appid={appId}
        url={source.src}
        kind={kind}
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
    resources.some((resource) => resource.visible && resource.key === `miniapp:${focusedAppId}`)
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
          secondary={resource.key === `miniapp:${splitMiniAppId}`}
          split={splitOpen}
          onFocusChange={handleFocus}
        />
      ))}
    </div>
  )
}
