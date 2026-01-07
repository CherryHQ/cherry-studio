import type { Express } from 'express'
import swaggerJSDoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'

import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('OpenAPIMiddleware')

const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cherry Studio API Gateway',
      version: '1.0.0',
      description:
        'API Gateway for Cherry Studio. Provides OpenAI and Anthropic compatible endpoints.\n\n' +
        '## Model Groups\n' +
        'Configure model groups in Settings to get simplified endpoints:\n' +
        '- `/{groupId}/v1/chat/completions` - OpenAI format with pre-configured model\n' +
        '- `/{groupId}/v1/messages` - Anthropic format with pre-configured model\n\n' +
        '## Direct Access\n' +
        'Use `provider_id:model_id` format for model parameter to access any model directly.\n\n' +
        '## MCP Servers\n' +
        'Access configured MCP servers via HTTP transport at `/v1/mcps/{server_id}/mcp`.',
      contact: {
        name: 'Cherry Studio',
        url: 'https://github.com/CherryHQ/cherry-studio'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Current server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Use the API key from Cherry Studio settings'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                type: { type: 'string' },
                code: { type: 'string' }
              }
            }
          }
        },
        ChatMessage: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              enum: ['system', 'user', 'assistant', 'tool']
            },
            content: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      text: { type: 'string' },
                      image_url: {
                        type: 'object',
                        properties: {
                          url: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              ]
            },
            name: { type: 'string' },
            tool_calls: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  function: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      arguments: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        ChatCompletionRequest: {
          type: 'object',
          required: ['model', 'messages'],
          properties: {
            model: {
              type: 'string',
              description: 'The model to use for completion, in format provider:model-id'
            },
            messages: {
              type: 'array',
              items: { $ref: '#/components/schemas/ChatMessage' }
            },
            temperature: {
              type: 'number',
              minimum: 0,
              maximum: 2,
              default: 1
            },
            max_tokens: {
              type: 'integer',
              minimum: 1
            },
            stream: {
              type: 'boolean',
              default: false
            },
            tools: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  function: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      parameters: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        },
        Model: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            object: { type: 'string', enum: ['model'] },
            created: { type: 'integer' },
            owned_by: { type: 'string' }
          }
        },
        MCPServer: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            command: { type: 'string' },
            args: {
              type: 'array',
              items: { type: 'string' }
            },
            env: { type: 'object' },
            disabled: { type: 'boolean' }
          }
        }
      }
    },
    security: [
      {
        BearerAuth: []
      }
    ]
  },
  // Only include gateway/external API routes (exclude internal APIs like agents)
  apis: [
    './src/main/apiGateway/routes/chat.ts',
    './src/main/apiGateway/routes/messages.ts',
    './src/main/apiGateway/routes/models.ts',
    './src/main/apiGateway/routes/mcp.ts',
    './src/main/apiGateway/app.ts'
  ]
}

export function setupOpenAPIDocumentation(app: Express) {
  try {
    const specs = swaggerJSDoc(swaggerOptions)

    // Serve OpenAPI JSON
    app.get('/api-docs.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(specs)
    })

    // Serve Swagger UI
    app.use(
      '/api-docs',
      swaggerUi.serve,
      swaggerUi.setup(specs, {
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
