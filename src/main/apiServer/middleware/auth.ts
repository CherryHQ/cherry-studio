import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'

import { config } from '../config'

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.header('Authorization') || ''
  const xApiKey = req.header('x-api-key') || ''

  // Fast rejection if neither credential header provided
  if (!auth && !xApiKey) {
    return res.status(401).json({ error: 'Unauthorized: missing credentials' })
  }

  let token: string | undefined

  // Prefer Bearer if well‑formed
  if (auth) {
    const trimmed = auth.trim()
    const bearerPrefix = /^Bearer\s+/i
    if (bearerPrefix.test(trimmed)) {
      const candidate = trimmed.replace(bearerPrefix, '').trim()
      if (!candidate) {
        return res.status(401).json({ error: 'Unauthorized: empty bearer token' })
      }
      token = candidate
    }
  }

  // Fallback to x-api-key if token still not resolved
  if (!token && xApiKey) {
    if (!xApiKey.trim()) {
      return res.status(401).json({ error: 'Unauthorized: empty x-api-key' })
    }
    token = xApiKey.trim()
  }

  if (!token) {
    // At this point we had at least one header, but none yielded a usable token
    return res.status(401).json({ error: 'Unauthorized: invalid credentials format' })
  }

  const { apiKey } = await config.get()

  if (!apiKey) {
    // If server not configured, treat as forbidden (or could be 500). Choose 403 to avoid leaking config state.
    return res.status(403).json({ error: 'Forbidden' })
  }

  // Timing-safe compare when lengths match, else immediate forbidden
  if (token.length !== apiKey.length) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const tokenBuf = Buffer.from(token)
  const keyBuf = Buffer.from(apiKey)
  if (!crypto.timingSafeEqual(tokenBuf, keyBuf)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  return next()
}
