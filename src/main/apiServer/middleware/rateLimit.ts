/**
 * Rate limiting middleware for the API server.
 * Uses a simple in-memory rate limiter to prevent abuse.
 */

import type { NextFunction, Request, Response } from 'express'

import { loggerService } from '../../core/logger/LoggerService'

const logger = loggerService.withContext('ApiServerRateLimit')

interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number
  /** Maximum number of requests per window */
  maxRequests: number
  /** Message to return when rate limit is exceeded */
  message?: string
  /** Whether to include rate limit headers */
  headers?: boolean
  /** Key generator function for identifying clients */
  keyGenerator?: (req: Request) => string
}

interface RateLimitEntry {
  count: number
  resetTime: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  message: 'Too many requests, please try again later.',
  headers: true,
  keyGenerator: (req: Request) => {
    // Use IP address as default key
    return req.ip || req.socket.remoteAddress || 'unknown'
  }
}

/**
 * Simple in-memory rate limiter
 */
class RateLimiter {
  private store = new Map<string, RateLimitEntry>()
  private config: RateLimitConfig

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60 * 1000)
  }

  /**
   * Check if a request should be rate limited
   */
  check(key: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now()
    const entry = this.store.get(key)

    if (!entry || now > entry.resetTime) {
      // New entry or expired
      const resetTime = now + this.config.windowMs
      this.store.set(key, { count: 1, resetTime })
      return { allowed: true, remaining: this.config.maxRequests - 1, resetTime }
    }

    if (entry.count >= this.config.maxRequests) {
      // Rate limit exceeded
      return { allowed: false, remaining: 0, resetTime: entry.resetTime }
    }

    // Increment count
    entry.count++
    return { allowed: true, remaining: this.config.maxRequests - entry.count, resetTime: entry.resetTime }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Get current stats
   */
  getStats(): { totalKeys: number; activeKeys: number } {
    const now = Date.now()
    let activeKeys = 0
    for (const entry of this.store.values()) {
      if (now <= entry.resetTime) {
        activeKeys++
      }
    }
    return { totalKeys: this.store.size, activeKeys }
  }
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const limiter = new RateLimiter(config)
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = mergedConfig.keyGenerator!(req)
    const { allowed, remaining, resetTime } = limiter.check(key)

    // Add rate limit headers
    if (mergedConfig.headers) {
      res.setHeader('X-RateLimit-Limit', mergedConfig.maxRequests)
      res.setHeader('X-RateLimit-Remaining', remaining)
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000))
    }

    if (!allowed) {
      logger.warn(`Rate limit exceeded for ${key}`)
      res.status(429).json({
        error: {
          message: mergedConfig.message,
          type: 'rate_limit_exceeded',
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
        }
      })
      return
    }

    next()
  }
}

/**
 * Default rate limit middleware with standard settings
 */
export const rateLimitMiddleware = createRateLimitMiddleware()

/**
 * Strict rate limit middleware for sensitive endpoints
 */
export const strictRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20, // 20 requests per minute
  message: 'Too many requests to sensitive endpoint, please try again later.'
})

/**
 * Lenient rate limit middleware for read-only endpoints
 */
export const lenientRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 200, // 200 requests per minute
  message: 'Too many requests, please try again later.'
})
