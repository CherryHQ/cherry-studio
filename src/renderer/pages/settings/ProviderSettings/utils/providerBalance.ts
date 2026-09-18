import { ProviderBalanceErrorCode } from '@shared/ipc/errors/providerBalance'

export const balanceErrorKeys: Record<string, string> = {
  [ProviderBalanceErrorCode.AUTH]: 'settings.provider.balance_query.error_auth',
  [ProviderBalanceErrorCode.CONFIG]: 'settings.provider.balance_query.error_config',
  [ProviderBalanceErrorCode.NETWORK]: 'settings.provider.balance_query.error_network',
  [ProviderBalanceErrorCode.RATE_LIMIT]: 'settings.provider.balance_query.error_rate_limit',
  [ProviderBalanceErrorCode.RESPONSE]: 'settings.provider.balance_query.error_response',
  [ProviderBalanceErrorCode.UNSUPPORTED]: 'settings.provider.balance_query.error_unsupported'
}
