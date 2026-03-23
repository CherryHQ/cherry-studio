import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next()
}))

vi.mock('../middleware/gateway', () => ({
  gatewayMiddleware: (_req: any, _res: any, next: any) => next()
}))

vi.mock('../middleware/error', () => ({
  errorHandler: (err: any, _req: any, res: any) => {
    res.status(500).json({ error: String(err) })
  }
}))

vi.mock('../middleware/openapi', () => ({
  setupOpenAPIDocumentation: vi.fn()
}))

vi.mock('../routes/chat', async () => {
  const express = (await import('express')).default
  const router = express.Router()
  router.all(/.*/, (_req, res) => res.json({ label: 'chat' }))
  return { chatRoutes: router }
})

vi.mock('../routes/models', async () => {
  const express = (await import('express')).default
  const router = express.Router()
  router.all(/.*/, (_req, res) => res.json({ label: 'models' }))
  return { modelsRoutes: router }
})

vi.mock('../routes/responses', async () => {
  const express = (await import('express')).default
  const router = express.Router()
  router.all(/.*/, (_req, res) => res.json({ label: 'responses' }))
  return { responsesRoutes: router }
})

vi.mock('../routes/mcp', async () => {
  const express = (await import('express')).default
  const router = express.Router()
  router.all(/.*/, (_req, res) => res.json({ label: 'mcps' }))
  return { mcpRoutes: router }
})

vi.mock('../routes/agents', async () => {
  const express = (await import('express')).default
  const router = express.Router()
  router.all(/.*/, (_req, res) => res.json({ label: 'agents' }))
  return { agentsRoutes: router }
})

vi.mock('../routes/messages', async () => {
  const express = (await import('express')).default
  const messagesRoutes = express.Router({ mergeParams: true })
  messagesRoutes.all(/.*/, (req, res) => res.json({ label: 'group-or-v1-messages', params: req.params }))

  const messagesTargetRoutes = express.Router({ mergeParams: true })
  messagesTargetRoutes.all(/.*/, (req, res) => res.json({ label: 'target-messages', params: req.params }))

  return { messagesRoutes, messagesTargetRoutes }
})

describe('api gateway route ordering', () => {
  let server: Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    const { app } = await import('../app')
    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve()
      server.close((err) => (err ? reject(err) : resolve()))
    })
    server = undefined
  })

  it('routes /v1/models to the static /v1 router instead of treating v1 as groupId', async () => {
    const response = await fetch(`${baseUrl}/v1/models`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ label: 'models' })
  })

  it('routes /:provider/v1/messages to the provider router', async () => {
    const response = await fetch(`${baseUrl}/openai/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      label: 'target-messages',
      params: { target: 'openai' }
    })
  })

  it('routes /:groupId/v1/messages to the group router', async () => {
    const response = await fetch(`${baseUrl}/group-a/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      label: 'target-messages',
      params: { target: 'group-a' }
    })
  })
})
