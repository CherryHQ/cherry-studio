import { useProviderAuthConfig } from '@renderer/hooks/useProvider'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { Provider } from '@shared/data/types/provider'
import { matchesPreset } from '@shared/utils/provider'

import { getProviderDisplayName } from './utils'

export function useProviderIdentityLabel(provider: Provider): string {
  const isCodex = matchesPreset(provider, OPENAI_CODEX_PROVIDER_ID)
  const { data } = useProviderAuthConfig(isCodex ? provider.id : '')
  const name = getProviderDisplayName(provider)
  return isCodex && data && 'accountId' in data && data.accountId ? `${name} · ${data.accountId}` : name
}

export function ProviderIdentity({ provider }: { provider: Provider }) {
  return <>{useProviderIdentityLabel(provider)}</>
}
