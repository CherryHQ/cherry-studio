export const MAIN_NETWORK_DEVTOOLS_DEFAULT_PORT = 38997

const allowedOrigins = new Set<string>()

export function getMainNetworkDevtoolsPort(): number {
  return MAIN_NETWORK_DEVTOOLS_DEFAULT_PORT
}

export function registerMainNetworkDevtoolsOrigin(origin: string): void {
  allowedOrigins.add(normalizeOrigin(origin))
}

export function isMainNetworkDevtoolsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false
  return allowedOrigins.has(normalizeOrigin(origin))
}

export function clearMainNetworkDevtoolsOrigins(): void {
  allowedOrigins.clear()
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '')
}
