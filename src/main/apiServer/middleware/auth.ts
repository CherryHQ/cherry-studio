import { NextFunction, Request, Response } from 'express'

import { config } from '../config'

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.header('Authorization')

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = auth.slice(7) // Remove 'Bearer ' prefix

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized, Bearer token is empty' })
  }

  const { apiKey } = await config.get()

  if (token !== apiKey) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  return next()
}
