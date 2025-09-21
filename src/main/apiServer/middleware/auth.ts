import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'

import { config } from '../config'

const isValidToken = (token: string, apiKey: string): boolean => {
  if (token.length !== apiKey.length) {
    return false
  }
  const tokenBuf = Buffer.from(token)
  const keyBuf = Buffer.from(apiKey)
  return crypto.timingSafeEqual(tokenBuf, keyBuf)
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.header('authorization') || ''
  const xApiKey = req.header('x-api-key') || ''

  // Fast rejection if neither credential header provided
  if (!auth && !xApiKey) {
    return res.status(401).json({ error: 'Unauthorized: missing credentials' })
  }

  const { apiKey } = await config.get()

  if (!apiKey) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // Check API key first (priority)
  if (xApiKey) {
    const trimmedApiKey = xApiKey.trim()
    if (!trimmedApiKey) {
      return res.status(401).json({ error: 'Unauthorized: empty x-api-key' })
    }

    if (isValidToken(trimmedApiKey, apiKey)) {
      return next()
    } else {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  // Fallback to Bearer token
  if (auth) {
    const trimmed = auth.trim()
    const bearerPrefix = /^Bearer\s+/i

    if (!bearerPrefix.test(trimmed)) {
      return res.status(401).json({ error: 'Unauthorized: invalid authorization format' })
    }

    const token = trimmed.replace(bearerPrefix, '').trim()
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: empty bearer token' })
    }

    if (isValidToken(token, apiKey)) {
      return next()
    } else {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  return res.status(401).json({ error: 'Unauthorized: invalid credentials format' })
}
