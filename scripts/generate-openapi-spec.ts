import * as fs from 'fs'
import * as path from 'path'
import swaggerJSDoc from 'swagger-jsdoc'

const ROOT_DIR = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(ROOT_DIR, 'src/main/apiServer/generated')
const OUTPUT_FILE = path.resolve(OUTPUT_DIR, 'openapi-spec.json')

const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cherry Studio API',
      version: '1.0.0',
      description: 'OpenAI-compatible API for Cherry Studio with additional Cherry-specific endpoints',
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
  apis: [
    path.resolve(ROOT_DIR, 'src/main/apiServer/routes/**/*.ts'),
    path.resolve(ROOT_DIR, 'src/main/apiServer/app.ts')
  ]
}

function generate(): string {
  const spec = swaggerJSDoc(swaggerOptions) as Record<string, any>
  return JSON.stringify(spec, null, 2) + '\n'
}

function check(content: string): void {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error(`openapi:check failed — ${OUTPUT_FILE} does not exist (run pnpm generate:openapi)`)
    process.exit(1)
  }

  const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
  const generated = JSON.parse(content)
  if (JSON.stringify(existing) !== JSON.stringify(generated)) {
    console.error('openapi:check failed — openapi-spec.json is out of date (run pnpm generate:openapi)')
    process.exit(1)
  }

  console.log('openapi:check passed')
}

function write(content: string): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  fs.writeFileSync(OUTPUT_FILE, content, 'utf-8')

  const spec = JSON.parse(content)
  const paths: string[] = spec.paths ? Object.keys(spec.paths) : []
  console.log(`OpenAPI spec generated: ${OUTPUT_FILE}`)
  console.log(`  Paths: ${paths.length}`)
  for (const p of paths) {
    const methods = Object.keys(spec.paths[p]).join(', ').toUpperCase()
    console.log(`    ${methods} ${p}`)
  }
}

const isCheck = process.argv.includes('--check')
const content = generate()

if (isCheck) {
  check(content)
} else {
  write(content)
}
