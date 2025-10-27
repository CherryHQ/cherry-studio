import { NextFunction, Request, Response } from 'express'
import { ZodError, ZodType } from 'zod'

export interface ValidationRequest extends Request {
  validatedBody?: any
  validatedParams?: any
  validatedQuery?: any
}

export interface ZodValidationConfig {
  body?: ZodType
  params?: ZodType
  query?: ZodType
}

export const createZodValidator = (config: ZodValidationConfig) => {
  return (req: ValidationRequest, res: Response, next: NextFunction): void => {
    try {
      if (config.body && req.body) {
        req.validatedBody = config.body.parse(req.body)
      }

      if (config.params && req.params) {
        req.validatedParams = config.params.parse(req.params)
      }

      if (config.query && req.query) {
        req.validatedQuery = config.query.parse(req.query)
      }

      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.issues.map((err) => ({
          type: 'field',
          value: err.input,
          msg: err.message,
          path: err.path.map((p) => String(p)).join('.'),
          location: getLocationFromPath(err.path, config)
        }))

        res.status(400).json({
          error: {
            message: 'Validation failed',
            type: 'validation_error',
            details: validationErrors
          }
        })
        return
      }

      res.status(500).json({
        error: {
          message: 'Internal validation error',
          type: 'internal_error',
          code: 'validation_processing_failed'
        }
      })
    }
  }
}

function getLocationFromPath(path: (string | number | symbol)[], config: ZodValidationConfig): string {
  if (config.body && path.length > 0) return 'body'
  if (config.params && path.length > 0) return 'params'
  if (config.query && path.length > 0) return 'query'
  return 'unknown'
}
