import useSWRImmutable from 'swr/immutable'

export function useExternalApps() {
  return useSWRImmutable('external-apps/installed', async () => window.api.externalApps.detectInstalled())
}
