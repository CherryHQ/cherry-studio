import { createMiddleware } from 'hono/factory'

import { config } from '../config'

export const authMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization')

  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header required' }, 401)
  }

  const token = auth.slice(7) // Remove 'Bearer ' prefix
  const { apiKey } = config.get()

  if (token !== apiKey) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  return next()
})
