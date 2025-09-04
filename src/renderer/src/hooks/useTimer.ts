import { useEffect, useRef } from 'react'

/**
 * 定时器管理 Hook，用于管理 setTimeout 和 setInterval 定时器，支持通过 key 来标识不同的定时器
 *
 * - 在设置定时器时以前会自动清理相同key的定时器
 * - 组件卸载时会自动清理所有定时器，避免内存泄漏
 *
 * 通常在 `useEffect` 中使用的定时器，可以通过清理函数处理。但是，在函数中使用的定时器则相对难以管理。
 * 这个 Hook 主要解决需要在函数中设置定时器的场景。然而，`setTimeoutTimer` 和 `setIntervalTimer` 同样也返回清理函数，因此可以用于 `useEffect` 中。
 *
 * @example
 * ```ts
 * function MyComponent() {
 *   const {
 *     setTimeoutTimer,
 *     setIntervalTimer,
 *     clearTimeoutTimer,
 *     clearAllTimers
 *   } = useTimer();
 *
 *   useEffect(() => {
 *     // 设置一个3秒后执行的定时器
 *     setTimeoutTimer('notify', () => {
 *       console.log('3秒后执行');
 *     }, 3000);
 *
 *     // 设置一个每5秒执行一次的定时器
 *     const cleanup = setIntervalTimer('poll', () => {
 *       console.log('每5秒执行一次');
 *     }, 5000);
 *
 *     // 手动清理指定的定时器
 *     clearTimeoutTimer('notify');
 *
 *     // 返回清理函数来停止轮询
 *     return cleanup;
 *   }, []);
 * }
 * ```
 */
export const useTimer = () => {
  const timeoutMapRef = useRef(new Map<string, NodeJS.Timeout>())
  const intervalMapRef = useRef(new Map<string, NodeJS.Timeout>())

  // 组件卸载时自动清理所有定时器
  useEffect(() => {
    return () => clearAllTimers()
  }, [])

  /**
   * 设置一个 setTimeout 定时器
   * @param key - 定时器标识符，用于标识和管理不同的定时器实例
   * @param args - setTimeout 的参数列表，包含回调函数和延迟时间（毫秒）
   * @returns 返回一个清理函数，可以用来手动清除该定时器
   * @example
   * ```ts
   * const { setTimeoutTimer } = useTimer();
   * // 设置一个3秒后执行的定时器
   * const cleanup = setTimeoutTimer('myTimer', () => {
   *   console.log('Timer executed');
   * }, 3000);
   *
   * // 需要时可以提前清理定时器
   * cleanup();
   * ```
   */
  const setTimeoutTimer = (key: string, ...args: Parameters<typeof setTimeout>) => {
    clearTimeout(timeoutMapRef.current.get(key))
    const timer = setTimeout(...args)
    timeoutMapRef.current.set(key, timer)
    return () => clearTimeoutTimer(key)
  }

  /**
   * 设置一个 setInterval 定时器
   * @param key - 定时器标识符，用于标识和管理不同的定时器实例
   * @param args - setInterval 的参数列表，包含回调函数和时间间隔（毫秒）
   * @returns 返回一个清理函数，可以用来手动清除该定时器
   * @example
   * ```ts
   * const { setIntervalTimer } = useTimer();
   * // 设置一个每3秒执行一次的定时器
   * const cleanup = setIntervalTimer('myTimer', () => {
   *   console.log('Timer executed');
   * }, 3000);
   *
   * // 需要时可以停止定时器
   * cleanup();
   * ```
   */
  const setIntervalTimer = (key: string, ...args: Parameters<typeof setInterval>) => {
    clearInterval(intervalMapRef.current.get(key))
    const timer = setInterval(...args)
    intervalMapRef.current.set(key, timer)
    return () => clearIntervalTimer(key)
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
