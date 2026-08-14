import useSWRImmutable from 'swr/immutable'

export function useExternalApps(options?: { enabled?: boolean }) {
  return useSWRImmutable(options?.enabled === false ? null : 'external-apps/installed', async () =>
    window.api.externalApps.detectInstalled()
  )
}
