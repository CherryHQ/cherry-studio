/**
 * Which registered providers can be used without paying.
 *
 * Fork-local on purpose: the upstream provider registry describes how to talk to a provider, not
 * what it costs, and editing sixty of its files to add a flag would make every upstream merge
 * worse. This is a pointer, not a contract — allowances change, so the UI sends the user to the
 * provider's own key page (`metadata.website.apiKey`) rather than quoting numbers that go stale.
 */

/** How a provider can be reached for nothing. */
export type FreeAccessKind =
  /** Hosted, and the account's free allowance is enough to chat with. Needs a key. */
  | 'free-tier'
  /** Hosted, and some of its models cost nothing while others are paid. Needs a key. */
  | 'free-models'
  /** Runs on this machine, so there is nothing to pay and no key to get. */
  | 'local'

export const FREE_ACCESS_PROVIDERS: Readonly<Record<string, FreeAccessKind>> = {
  cerebras: 'free-tier',
  gemini: 'free-tier',
  groq: 'free-tier',
  huggingface: 'free-tier',
  mistral: 'free-tier',
  modelscope: 'free-tier',
  nvidia: 'free-tier',

  openrouter: 'free-models',
  silicon: 'free-models',
  together: 'free-models',

  lmstudio: 'local',
  ollama: 'local',
  ovms: 'local'
}

export function freeAccessKindOf(providerId: string): FreeAccessKind | undefined {
  return FREE_ACCESS_PROVIDERS[providerId]
}

/** True for anything usable without paying, hosted or local. */
export function isFreeAccessProvider(providerId: string): boolean {
  return providerId in FREE_ACCESS_PROVIDERS
}
