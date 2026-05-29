import useSWRImmutable from 'swr/immutable'

async function loadOvmsSupport(): Promise<boolean> {
  try {
    return await window.api.ovms.isSupported()
  } catch {
    return false
  }
}

export function useOvmsSupport() {
  const { data } = useSWRImmutable('ovms/isSupported', loadOvmsSupport)

  return { isSupported: data }
}
