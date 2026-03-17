import type { Express } from 'express'
import swaggerUi from 'swagger-ui-express'

import openapiSpec from '../../apiServer/generated/openapi-spec.json'
import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('OpenAPIMiddleware')

export function setupOpenAPIDocumentation(app: Express) {
  try {
    // Serve OpenAPI JSON
    app.get('/api-docs.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(openapiSpec)
    })

    // Serve Swagger UI
    app.use(
      '/api-docs',
      swaggerUi.serve,
      swaggerUi.setup(openapiSpec as object, {
        customCss: `
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info .title { color: #1890ff; }
      `,
        customSiteTitle: 'Cherry Studio API Documentation'
      })
    )

    logger.info('OpenAPI documentation ready', {
      docsPath: '/api-docs',
      specPath: '/api-docs.json'
    })
  } catch (error) {
    logger.error('Failed to setup OpenAPI documentation', { error })
  }
}
