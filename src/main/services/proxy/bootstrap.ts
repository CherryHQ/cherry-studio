import { applyNodeProxyFromEnvironment } from './nodeProxy'

try {
  applyNodeProxyFromEnvironment()
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(
    `[CherryStudioProxyBootstrap] Proxy bootstrap failed - child process will run WITHOUT proxy: ${message}\n`
  )
}
