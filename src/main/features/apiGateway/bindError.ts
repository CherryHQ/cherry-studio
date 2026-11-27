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

export function mapGatewayBindError(
  error: unknown,
  endpoint: { host: string; port: number },
  listener: 'public' | 'internal'
): unknown {
  if (!isGatewayBindPermissionError(error)) return error
  const bindError = error as NodeJS.ErrnoException & { address?: string; port?: number }

  const address = typeof bindError.address === 'string' ? bindError.address : endpoint.host
  const port = typeof bindError.port === 'number' ? bindError.port : endpoint.port
  const message =
    listener === 'public'
      ? t('api_gateway.errors.public_bind_permission_denied', { address, port })
      : t('api_gateway.errors.internal_bind_permission_denied', { address, port })
  return new Error(message, { cause: error })
}
