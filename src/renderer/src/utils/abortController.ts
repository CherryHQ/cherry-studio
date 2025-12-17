import { loggerService } from '@logger'

const logger = loggerService.withContext('AbortController')

export const abortMap = new Map<string, (() => void)[]>()

export const addAbortController = (id: string, abortFn: () => void) => {
  abortMap.set(id, [...(abortMap.get(id) || []), abortFn])
}

export const removeAbortController = (id: string, abortFn: () => void) => {
  const callbackArr = abortMap.get(id)
  if (abortFn && callbackArr) {
    const index = callbackArr.indexOf(abortFn)
    if (index !== -1) {
      callbackArr.splice(index, 1)
    }
  } else {
    abortMap.delete(id)
  }
}

export const abortCompletion = (id: string) => {
  const abortFns = abortMap.get(id)
  if (abortFns?.length) {
    for (const fn of [...abortFns]) {
      fn()
      removeAbortController(id, fn)
    }
  }
}

export function createAbortPromise<T>(signal: AbortSignal, finallyPromise: Promise<T>) {
  return new Promise<T>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Operation aborted', 'AbortError'))
      return
    }

    const abortHandler = (e: Event) => {
      logger.debug('abortHandler', e)
      reject(new DOMException('Operation aborted', 'AbortError'))
    }

    signal.addEventListener('abort', abortHandler, { once: true })

    finallyPromise.finally(() => {
      signal.removeEventListener('abort', abortHandler)
    })
  })
}

/**
 * 创建一个新的 AbortController 并将其注册到全局的 abort 映射中
 * @param key - 用于标识此 AbortController 的唯一键值
 * @returns AbortSignal - 返回 AbortController 的信号
 * @example
 * ```typescript
 * const signal = readyToAbort('uniqueKey');
 * fetch('https://api.example.com/data', { signal })
 *   .then(response => response.json())
 *   .catch(error => {
 *     if (error.name === 'AbortError') {
 *       console.log('Fetch aborted');
 *     }
 *   });
 * ```
 */
export function readyToAbort(key: string) {
  const controller = new AbortController()
  addAbortController(key, () => controller.abort())
  return controller.signal
}
