import { t } from '@main/i18n'

export function isGatewayBindPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'EACCES' &&
    'syscall' in error &&
    error.syscall === 'listen'
  )
}

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-known-value-widening -- Listen promises can reject with any value; translate only recognized permission errors and preserve every other rejection by identity. */
export function mapGatewayBindError(
  error: unknown,
  endpoint: { host: string; port: number },
  listener: 'public' | 'internal'
): unknown {
  if (!isGatewayBindPermissionError(error)) return error

  const address = 'address' in error && typeof error.address === 'string' ? error.address : endpoint.host
  const port = 'port' in error && typeof error.port === 'number' ? error.port : endpoint.port
  const message =
    listener === 'public'
      ? t('api_gateway.errors.public_bind_permission_denied', { address, port })
      : t('api_gateway.errors.internal_bind_permission_denied', { address, port })
  return new Error(message, { cause: error })
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-known-value-widening */
