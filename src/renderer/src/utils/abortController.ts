export const abortMap = new Map<string, () => void>()

export const addAbortController = (id: string, abortFn: () => void) => {
  let callback = abortFn
  const existingCallback = abortMap.get(id)
  if (existingCallback) {
    callback = () => {
      existingCallback?.()
      abortFn()
    }
  }
  abortMap.set(id, callback)
}

export const removeAbortController = (id: string) => {
  abortMap.delete(id)
}

export const abortCompletion = (id: string) => {
  const abortFn = abortMap.get(id)
  if (abortFn) {
    abortFn()
    removeAbortController(id)
  }
}
