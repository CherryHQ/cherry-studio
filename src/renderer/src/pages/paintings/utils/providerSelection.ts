export function getValidPaintingOptions(
  options: string[],
  isOvmsSupported: boolean,
  ovmsStatus: 'not-installed' | 'not-running' | 'running'
) {
  return options.filter((option) => {
    if (option === 'ovms') {
      return isOvmsSupported && ovmsStatus === 'running'
    }
    return true
  })
}

export function resolvePaintingProvider(
  requestedProvider: string | undefined,
  defaultProvider: string | undefined,
  validOptions: string[]
) {
  if (requestedProvider && validOptions.includes(requestedProvider)) {
    return requestedProvider
  }

  if (defaultProvider && validOptions.includes(defaultProvider)) {
    return defaultProvider
  }

  return validOptions[0]
}
