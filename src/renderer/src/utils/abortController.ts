export const abortMap = new Map<string, (() => void)[]>()

export const addAbortController = (id: string, abortFn: () => void) => {
  abortMap.set(id, [...(abortMap.get(id) || []), abortFn])
}

export const removeAbortController = (id: string, abortFn: () => void) => {
  const callbackArr = abortMap.get(id)
  if (abortFn) {
    callbackArr?.splice(callbackArr?.indexOf(abortFn), 1)
  } else abortMap.delete(id)
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
