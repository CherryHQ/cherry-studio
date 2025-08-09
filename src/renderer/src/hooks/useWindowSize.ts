import { loggerService } from '@logger'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { debounce } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'

const logger = loggerService.withContext('useWindowSize')

// NOTE: 开发中间产物，暂时没用上。可用于获取主窗口尺寸以实现精确的样式控制

/**
 * 获取主窗口尺寸的钩子函数
 * @returns 返回对象包含窗口的宽度和高度
 * @returns width - 窗口宽度
 * @returns height - 窗口高度
 * @description 该钩子函数用于监听和获取主窗口的尺寸变化。它会在窗口大小改变时自动更新，
 * 并提供防抖处理以优化性能。
 */
export const useWindowSize = () => {
  const [width, setWidth] = useState<number>(MIN_WINDOW_WIDTH)
  const [height, setHeight] = useState<number>(MIN_WINDOW_HEIGHT)

  const debouncedGetSize = useMemo(
    () =>
      debounce(async () => {
        const [currentWidth, currentHeight] = await window.api.window.getSize()
        logger.debug('Windows_GetSize', { width: currentWidth, height: currentHeight })
        setWidth(currentWidth)
        setHeight(currentHeight)
      }, 200),
    []
  )

  const callback = useCallback(
    (_, [width, height]) => {
      logger.silly('Windows_Resize', { width, height })
      setWidth(width)
      setHeight(height)
      debouncedGetSize()
    },
    [debouncedGetSize]
  )

  useEffect(() => {
    // 设置监听器
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.Windows_Resize, callback)

    return () => {
      cleanup()
    }
  }, [callback])

  // 手动触发一次
  useEffect(() => {
    debouncedGetSize()
  }, [debouncedGetSize])

  return {
    width,
    height
  }
}
