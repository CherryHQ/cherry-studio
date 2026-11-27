export function describeRegistryLoadFailure(error: unknown): { message: string; cause: string } {
  const cause = error instanceof Error ? error.cause : undefined
  const code = cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined
  const discriminator = code ?? (cause instanceof Error ? cause.name : undefined)
  return {
    message: error instanceof Error ? error.message : 'Failed to load registry file',
    cause: discriminator && /^[a-zA-Z0-9_]{1,64}$/.test(discriminator) ? discriminator : 'UnknownError'
  }
}
