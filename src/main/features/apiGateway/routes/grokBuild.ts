import { Elysia } from 'elysia'
import * as z from 'zod'

import { GROK_SESSION_SUMMARY_PATH } from '@shared/utils/apiGateway'

import { processMessage } from '../proxyStream'
import { ChatCompletionBodySchema } from './schemas'

const titleChoice = z.object({ type: z.literal('function'), function: z.object({ name: z.literal('session_title') }) })

export const grokBuildRoutes = new Elysia({ prefix: GROK_SESSION_SUMMARY_PATH }).post(
  '/chat/completions',
  ({ body, request }) =>
    processMessage({
      params: body,
      inputFormat: 'openai',
      outputFormat: 'openai',
      signal: request.signal,
      requestHeaders: request.headers,
      defaultReasoningEffort: titleChoice.safeParse(body.tool_choice).success ? 'none' : undefined
    }),
  { body: ChatCompletionBodySchema, detail: { hide: true } }
)
