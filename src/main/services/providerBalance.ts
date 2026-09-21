import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { Provider } from '@shared/data/types/provider'
import {
  type ProviderBalance,
  type ProviderBalanceConfig,
  ProviderBalanceConfigSchema,
  ProviderBalanceSchema
} from '@shared/data/types/providerBalance'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { ProviderBalanceErrorCode as Code } from '@shared/ipc/errors/providerBalance'
import { net } from 'electron'
import { get } from 'es-toolkit/compat'
import * as z from 'zod'

const logger = loggerService.withContext('ProviderBalance')
const AmountSchema = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d+)?$/)
    .transform(Number)
    .pipe(z.number())
])
const DeepSeekResponseSchema = z.object({
  balance_infos: z.array(z.object({ currency: z.string(), total_balance: AmountSchema })).min(1)
})
const MoonshotResponseSchema = z.object({ data: z.object({ available_balance: AmountSchema }) })
const PpioResponseSchema = z.object({ availableBalance: AmountSchema })
const GatewayResponseSchema = z.object({ balance: AmountSchema })

const builtInQueries = {
  deepseek: {
    path: 'user/balance',
    rechargeUrl: 'https://platform.deepseek.com/top_up',
    parse: (body: unknown) =>
      DeepSeekResponseSchema.parse(body).balance_infos.map(({ currency, total_balance }) => ({
        currency,
        amount: total_balance
      }))
  },
  moonshot: {
    path: 'v1/users/me/balance',
    rechargeUrl: 'https://platform.moonshot.cn/console/account',
    parse: (body: unknown) => [{ currency: 'CNY', amount: MoonshotResponseSchema.parse(body).data.available_balance }]
  },
  ppio: {
    // Billing has a separate host from PPIO's inference endpoints.
    path: 'https://api.ppio.com/openapi/v1/billing/balance/detail',
    rechargeUrl: undefined,
    parse: (body: unknown) => [{ currency: 'CNY', amount: PpioResponseSchema.parse(body).availableBalance / 10000 }]
  },
  gateway: {
    path: 'v1/credits',
    rechargeUrl: undefined,
    parse: (body: unknown) => [{ currency: 'USD', amount: GatewayResponseSchema.parse(body).balance }]
  }
} satisfies Record<
  string,
  { path: string; rechargeUrl?: string; parse: (body: unknown) => ProviderBalance['balances'] }
>

export const BALANCE_PROVIDER_IDS = Object.keys(builtInQueries)

function resolveQuery(provider: Provider, draft?: ProviderBalanceConfig) {
  if (provider.supportsBalance && !draft) {
    const presetId = provider.presetProviderId ?? provider.id
    const query = Object.hasOwn(builtInQueries, presetId)
      ? builtInQueries[presetId as keyof typeof builtInQueries]
      : undefined
    if (!query) throw new IpcError(Code.UNSUPPORTED)
    const baseUrl = provider.endpointConfigs?.['openai-chat-completions']?.baseUrl
    if (!baseUrl) throw new IpcError(Code.CONFIG)
    const endpoint = new URL(query.path, `${baseUrl.replace(/\/+$/, '').replace(/\/v1(?:\/ai)?$/, '')}/`).href
    return { ...query, endpoint }
  }

  if (provider.presetProviderId) throw new IpcError(Code.UNSUPPORTED)
  const parsed = ProviderBalanceConfigSchema.safeParse(draft ?? provider.settings.balanceQuery)
  if (!parsed.success || (!draft && !parsed.data.enabled)) throw new IpcError(Code.CONFIG)
  const config = parsed.data
  return {
    endpoint: config.endpoint,
    rechargeUrl: config.rechargeUrl || undefined,
    parse: (body: unknown) => [{ currency: config.currency, amount: AmountSchema.parse(get(body, config.amountPath)) }]
  }
}

/** Queries saved credentials; a draft is used only by the explicit settings test action. */
export async function queryProviderBalance(
  providerId: string,
  keyId: string,
  draft?: ProviderBalanceConfig
): Promise<ProviderBalance> {
  try {
    const provider = providerService.getByProviderId(providerId)
    const query = resolveQuery(provider, draft)
    const endpoint = z.url({ protocol: /^https?$/ }).parse(query.endpoint)
    const key = providerService.getApiKeys(providerId, { enabled: true }).find((entry) => entry.id === keyId)
    const auth = providerService.getAuthConfig(providerId)
    if (!key || (auth && auth.type !== 'api-key')) throw new IpcError(Code.AUTH)

    let response: Response
    try {
      const headers = new Headers(provider.settings.extraHeaders)
      headers.set(auth?.headerName || 'Authorization', `${auth?.prefix ?? 'Bearer'} ${key.key}`.trim())
      response = await net.fetch(endpoint, {
        method: 'GET',
        headers,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new IpcError(Code.NETWORK)
    }

    if (response.status === 401 || response.status === 403) throw new IpcError(Code.AUTH)
    if (response.status === 429) throw new IpcError(Code.RATE_LIMIT)
    if (response.status === 404 || response.status === 405) throw new IpcError(Code.UNSUPPORTED)
    if (!response.ok) throw new IpcError(Code.NETWORK)

    try {
      return ProviderBalanceSchema.parse({
        kind: 'account-balance',
        balances: query.parse(await response.json()),
        updatedAt: new Date().toISOString(),
        rechargeUrl: query.rechargeUrl
      })
    } catch {
      throw new IpcError(Code.RESPONSE)
    }
  } catch (error) {
    const safeError = error instanceof IpcError ? error : new IpcError(Code.CONFIG)
    logger.warn('Balance query failed', { providerId, code: safeError.code })
    throw safeError
  }
}
