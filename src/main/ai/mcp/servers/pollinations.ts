// Keyless image generation, as a tool that costs the model almost nothing.
//
// Pollinations serves a generated image straight from a GET URL, with no account and no API key, so
// the tool's whole job is to build that URL. It deliberately returns the *link* rather than the
// pixels: a base64 image is hundreds of thousands of tokens of context on every subsequent step of
// the turn, which on a free tier buys one picture and then an exhausted quota. The renderer draws
// the markdown image, and the model pays for a single line of text.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

const IMAGE_ENDPOINT = 'https://image.pollinations.ai/prompt/'

/** Generated sizes are capped at what the service actually serves; beyond this it errors out. */
const MAX_DIMENSION = 2048
const MIN_DIMENSION = 64

export const GenerateImagePayloadSchema = z.object({
  prompt: z.string().min(1),
  width: z.number().int().min(MIN_DIMENSION).max(MAX_DIMENSION).optional(),
  height: z.number().int().min(MIN_DIMENSION).max(MAX_DIMENSION).optional(),
  /** Same seed and prompt give the same image — how a caller iterates on one composition. */
  seed: z.number().int().min(0).optional(),
  model: z.string().min(1).optional()
})

export type GenerateImagePayload = z.infer<typeof GenerateImagePayloadSchema>

/**
 * The prompt is a path segment, so it is encoded rather than interpolated — an unencoded `?` or `#`
 * would otherwise truncate it into the query string and silently generate a different picture.
 */
export function buildImageUrl({ prompt, width, height, seed, model }: GenerateImagePayload): string {
  const url = new URL(IMAGE_ENDPOINT + encodeURIComponent(prompt.trim()))
  if (width) url.searchParams.set('width', String(width))
  if (height) url.searchParams.set('height', String(height))
  if (seed !== undefined) url.searchParams.set('seed', String(seed))
  if (model) url.searchParams.set('model', model)
  // The service watermarks by default; the caller asked for an illustration, not a logo.
  url.searchParams.set('nologo', 'true')
  return url.toString()
}

const server = new Server({ name: 'pollinations-image', version: '0.1.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_image',
      description:
        'Generate an image from a text prompt and return its URL. Free and keyless — prefer this ' +
        'over asking a chat model to describe or draw. The prompt must be in English for the best ' +
        'result. Present the returned markdown to the user as-is so the image renders.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to draw, in English.' },
          width: { type: 'number', description: `Pixel width, ${MIN_DIMENSION}-${MAX_DIMENSION}.` },
          height: { type: 'number', description: `Pixel height, ${MIN_DIMENSION}-${MAX_DIMENSION}.` },
          seed: { type: 'number', description: 'Reuse a seed to re-generate the same image.' },
          model: { type: 'string', description: 'Image model to use, e.g. "flux". Optional.' }
        },
        required: ['prompt']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'generate_image') {
    throw new Error('Tool not found')
  }

  const parsed = GenerateImagePayloadSchema.safeParse(request.params.arguments)
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true
    }
  }

  const url = buildImageUrl(parsed.data)
  return {
    content: [{ type: 'text', text: `![${parsed.data.prompt}](${url})\n\n${url}` }],
    isError: false
  }
})

export class PollinationsServer {
  public server: Server
  constructor() {
    this.server = server
  }
}

export default PollinationsServer
