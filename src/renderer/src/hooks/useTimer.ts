import { useEffect, useRef } from 'react'

/**
 * 定时器管理 Hook，用于管理 setTimeout 和 setInterval 定时器，支持通过 key 来标识不同的定时器
 *
 * - 在设置定时器时以前会自动清理相同key的定时器
 * - 组件卸载时会自动清理所有定时器，避免内存泄漏
 */
export const useTimer = () => {
  const timeoutMapRef = useRef(new Map<string, NodeJS.Timeout>())
  const intervalMapRef = useRef(new Map<string, NodeJS.Timeout>())

  // 组件卸载时自动清理所有定时器
  useEffect(() => {
    return clearAllTimers
  }, [])

  /**
   * 设置一个 setTimeout 定时器
   * @param key - 定时器标识符
   * @param args - setTimeout 的参数列表
   */
  const setTimeoutTimer = (key: string, ...args: Parameters<typeof setTimeout>) => {
    clearTimeout(timeoutMapRef.current.get(key))
    const timer = setTimeout(...args)
    timeoutMapRef.current.set(key, timer)
  }

  /**
   * 设置一个 setInterval 定时器
   * @param key - 定时器标识符
   * @param args - setInterval 的参数列表
   */
  const setIntervalTimer = (key: string, ...args: Parameters<typeof setInterval>) => {
    clearInterval(intervalMapRef.current.get(key))
    const timer = setInterval(...args)
    intervalMapRef.current.set(key, timer)
  }

  /**
   * 清除指定 key 的 setTimeout 定时器
   * @param key - 定时器标识符
   */
  const clearTimeoutTimer = (key: string) => {
    clearTimeout(timeoutMapRef.current.get(key))
    timeoutMapRef.current.delete(key)
  }

  /**
   * 清除指定 key 的 setInterval 定时器
   * @param key - 定时器标识符
   */
  const clearIntervalTimer = (key: string) => {
    clearInterval(intervalMapRef.current.get(key))
    intervalMapRef.current.delete(key)
  }

  /**
   * 清除所有 setTimeout 定时器
   */
  const clearAllTimeoutTimers = () => {
    timeoutMapRef.current.forEach((timer) => clearTimeout(timer))
    timeoutMapRef.current.clear()
  }

  /**
   * 清除所有 setInterval 定时器
   */
  const clearAllIntervalTimers = () => {
    intervalMapRef.current.forEach((timer) => clearInterval(timer))
    intervalMapRef.current.clear()
  }

  /**
   * 清除所有定时器，包括 setTimeout 和 setInterval
   */
  const clearAllTimers = () => {
    timeoutMapRef.current.forEach((timer) => clearTimeout(timer))
    intervalMapRef.current.forEach((timer) => clearInterval(timer))
    timeoutMapRef.current.clear()
    intervalMapRef.current.clear()
  }

  return {
    setTimeoutTimer,
    setIntervalTimer,
    clearTimeoutTimer,
    clearIntervalTimer,
    clearAllTimeoutTimers,
    clearAllIntervalTimers,
    clearAllTimers
  } as const
}
