/**
 * Which registered providers can generate images without paying.
 *
 * Fork-local on purpose (see freeTierProviders.ts). Image generation allowances
 * change even faster than text API tier shifts, so the UI sends the user to the
 * provider's own pricing page rather than quoting specific free credits.
 */

/** How a provider can be used for image generation without paying. */
export type FreeImageAccessKind =
  /** Hosted, and the account's free allowance can generate images. Needs a key. */
  | 'free-tier'
  /** Runs on this machine, so there is nothing to pay and no key to get. */
  | 'local'

export const FREE_IMAGE_PROVIDERS: Readonly<Record<string, FreeImageAccessKind>> = {
  google: 'free-tier', // Gemini Vision image generation free tier
  alibaba: 'free-tier', // Tongyi Vision free model
  ideogram: 'free-tier', // Free image generation tier
  kling: 'free-tier' // Free tier available
}

export function freeImageAccessKindOf(providerId: string): FreeImageAccessKind | undefined {
  return FREE_IMAGE_PROVIDERS[providerId]
}

/** True for any provider offering free image generation, hosted or local. */
export function isFreeImageAccessProvider(providerId: string): boolean {
  return providerId in FREE_IMAGE_PROVIDERS
}
