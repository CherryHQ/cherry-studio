import { DEFAULT_PROVIDER_SETTINGS, type Provider } from '@shared/data/types/provider'
import { CLI_OWN_LOGIN_PROVIDER_ID } from '@shared/types/codeCli'

/** Synthetic provider identity for selecting the CLI's own login. */
export const OWN_LOGIN_PROVIDER: Provider = {
  id: CLI_OWN_LOGIN_PROVIDER_ID,
  name: 'CLI own login',
  apiKeys: [],
  authType: 'oauth',
  authMethods: ['external-cli'],
  reportsActualCost: false,
  settings: DEFAULT_PROVIDER_SETTINGS,
  isEnabled: true
}
