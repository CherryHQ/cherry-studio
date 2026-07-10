import { ipcApi, useIpcOn } from '@renderer/ipc'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TITLE_BAR_HEIGHT_CLASS } from '../layout/titleBar'
import { SIDEBAR_ICON_WIDTH } from '../Sidebar'

const CONTROL_BUTTON_CLASS =
  'flex size-3 items-center justify-center rounded-full border border-black/15 p-0 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.2)] transition-[filter] [-webkit-app-region:no-drag] hover:brightness-95 active:brightness-85'
const CONTROL_ICON_CLASS =
  'size-2 text-black/70 opacity-0 transition-opacity group-hover/mac-window-controls:opacity-100'

export const MacWindowControls = () => {
  const { t } = useTranslation()
  const [isFullScreen, setIsFullScreen] = useState(false)
  const receivedFullScreenEvent = useRef(false)

  useEffect(() => {
    void ipcApi.request('window.is_full_screen').then((value) => {
      if (!receivedFullScreenEvent.current) setIsFullScreen(value)
    })
  }, [])

  const handleFullScreenChanged = useCallback((value: boolean) => {
    receivedFullScreenEvent.current = true
    setIsFullScreen(value)
  }, [])

  useIpcOn('window.fullscreen_changed', handleFullScreenChanged)

  const handleToggleFullScreen = () => {
    void ipcApi.request('window.set_full_screen', !isFullScreen)
  }

  const FullScreenIcon = isFullScreen ? Minimize2 : Maximize2

  return (
    <div
      data-testid="mac-window-controls"
      className={`group/mac-window-controls absolute top-0 left-0 z-50 flex items-center justify-center gap-1 [-webkit-app-region:no-drag] ${TITLE_BAR_HEIGHT_CLASS}`}
      style={{ width: SIDEBAR_ICON_WIDTH }}>
      <button
        type="button"
        aria-label={t('navbar.window.close')}
        onClick={() => void ipcApi.request('window.close')}
        className={`${CONTROL_BUTTON_CLASS} bg-[#ff5f57]`}>
        <X aria-hidden="true" className={CONTROL_ICON_CLASS} strokeWidth={3} />
      </button>
      <button
        type="button"
        aria-label={t('navbar.window.minimize')}
        onClick={() => void ipcApi.request('window.minimize')}
        className={`${CONTROL_BUTTON_CLASS} bg-[#febc2e]`}>
        <Minus aria-hidden="true" className={CONTROL_ICON_CLASS} strokeWidth={3} />
      </button>
      <button
        type="button"
        aria-label={t(isFullScreen ? 'navbar.window.restore' : 'navbar.window.maximize')}
        onClick={handleToggleFullScreen}
        className={`${CONTROL_BUTTON_CLASS} bg-[#28c840]`}>
        <FullScreenIcon aria-hidden="true" className={CONTROL_ICON_CLASS} strokeWidth={3} />
      </button>
    </div>
  )
}
