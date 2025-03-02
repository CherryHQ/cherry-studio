export function formatApiHost(host: string) {
  const forceUseOriginalHost = () => {
    if (host.endsWith('/')) {
      return true
    }

    if (host.endsWith('volces.com/api/v3')) {
      return true
    }

    return false
  }

  return forceUseOriginalHost() ? host : `${host}/v1/`
}

export function maskApiKey(key: string): string {
  if (!key) return ''

  if (key.length > 24) {
    return `${key.slice(0, 8)}****${key.slice(-8)}`
  } else if (key.length > 16) {
    return `${key.slice(0, 4)}****${key.slice(-4)}`
  } else if (key.length > 8) {
    return `${key.slice(0, 2)}****${key.slice(-2)}`
  } else {
    return key
  }
}
