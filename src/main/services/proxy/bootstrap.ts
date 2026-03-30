import { applyNodeProxyFromEnvironment } from './nodeProxy'

try {
  applyNodeProxyFromEnvironment()
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(`[CherryStudioProxyBootstrap] ${message}\n`)
}
