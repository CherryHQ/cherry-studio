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
