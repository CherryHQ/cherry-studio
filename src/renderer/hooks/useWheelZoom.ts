import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

export function useWheelZoom(): void {
  const { t } = useTranslation()

  useEffect(() => {
    const logger = loggerService.withContext('useWheelZoom')
    let accumulator = 0
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let revision = 0
    let mounted = true

    const adjustZoom = async (delta: number) => {
      const currentRevision = ++revision
      try {
        const factor = await ipcApi.request('app.adjust_zoom', { delta })
        if (!mounted || currentRevision !== revision) return
        toast.info({
          key: 'app-wheel-zoom',
          title: t('settings.zoom.title'),
          description: `${Math.round(factor * 100)}%`,
          timeout: 1500
        })
      } catch (error) {
        logger.error('Failed to adjust interface zoom', error as Error)
      }
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      if (event.deltaY === 0) return
      if (event.defaultPrevented) return
      event.preventDefault()

      const delta = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : Math.sign(event.deltaY) * 40
      if (accumulator && Math.sign(delta) !== Math.sign(accumulator)) accumulator = 0
      accumulator += delta
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        accumulator = 0
      }, 120)

      if (Math.abs(accumulator) < 40) return
      const direction = Math.sign(accumulator)
      accumulator = 0
      void adjustZoom(direction < 0 ? 0.1 : -0.1)
    }

    window.addEventListener('wheel', handleWheel, { capture: false, passive: false })
    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: false })
      clearTimeout(idleTimer)
      accumulator = 0
      mounted = false
      revision++
    }
  }, [t])
}
