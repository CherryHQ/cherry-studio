import { loggerService } from '@logger'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useWindowSize')

export const useWindowSize = () => {
  const [width, setWidth] = useState<number>(MIN_WINDOW_WIDTH)
  const [height, setHeight] = useState<number>(MIN_WINDOW_HEIGHT)

  const callback = (_, [width, height]) => {
    logger.debug('Windows_Resize', { width, height })
    setWidth(width)
    setHeight(height)
  }

  const getSize = async () => {
    const [currentWidth, currentHeight] = await window.api.window.getSize()
    logger.debug('Windows_GetSize', { width: currentWidth, height: currentHeight })
    setWidth(currentWidth)
    setHeight(currentHeight)
  }

  useEffect(() => {
    // 设置监听器
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.Windows_Resize, callback)

    // 手动触发一次
    getSize()

    return () => {
      cleanup()
    }
  }, [])

  return {
    width,
    height
  }
}
