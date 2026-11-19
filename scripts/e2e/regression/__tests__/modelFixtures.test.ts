import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { LLMock } from '@copilotkit/aimock'
import { generateText, stepCountIs, tool } from 'ai'
import { afterEach, beforeEach } from 'vitest'
import * as z from 'zod'

import { addModelFixtures } from '../modelFixtures'

let mock: LLMock
let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cherry-model-fixtures-'))
  mock = new LLMock({ port: 0, host: '127.0.0.1', strict: true, logLevel: 'silent' })
  addModelFixtures(mock)
  await mock.start()
})
afterEach(async () => {
  await mock.stop()
  rmSync(directory, { recursive: true, force: true })
})
const openai = () => createOpenAI({ baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'mock' }).chat('mock-chat')

// Catch fixtures that merely claim a file exists, bypass a denied tool, or use invalid protocol arguments.
it.each(['openai', 'anthropic'] as const)('drives a real file operation through %s tool rounds', async (protocol) => {
  const path = join(directory, 'result.txt')
  const result = await generateText({
    model:
      protocol === 'openai'
        ? openai()
        : createAnthropic({ baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'mock' })('mock-chat'),
    prompt: `Create the file at the exact absolute path ${JSON.stringify(path)} containing only AGENT_FILE_TASK_PASS, with no extra text or trailing newline.`,
    tools: {
      write: tool({
        inputSchema: z.object({ path: z.literal(path), content: z.literal('AGENT_FILE_TASK_PASS') }),
        execute: ({ path, content }) => {
          writeFileSync(path, content)
          return 'File written successfully'
        }
      })
    },
    stopWhen: stepCountIs(3)
  })
  expect(readFileSync(path, 'utf8')).toBe('AGENT_FILE_TASK_PASS')
  expect(result.text).toBe('AGENT_FILE_TASK_PASS')
  expect(result.steps).toHaveLength(2)
})

it('stops after a denied write without retrying or reporting success', async () => {
  const path = join(directory, 'denied.txt')
  const result = await generateText({
    model: openai(),
    prompt: `Use the Write tool exactly once to create ${JSON.stringify(path)} containing exactly MP51_PERMISSION_ALLOWED with no trailing newline.`,
    tools: {
      write: tool({
        inputSchema: z.object({ path: z.literal(path), content: z.string() }),
        execute: () => 'The user denied this operation'
      })
    },
    stopWhen: stepCountIs(3)
  })
  expect(existsSync(path)).toBe(false)
  expect(result.text).toContain('denied')
  expect(result.steps).toHaveLength(2)
})

it('discovers the exposed MCP tool and uses its actual result before answering', async () => {
  const result = await generateText({
    model: openai(),
    prompt: 'Call the everything MCP server get-sum tool with a=31415 and b=27182, then report its result.',
    tools: {
      tool_search: tool({
        inputSchema: z.object({ query: z.string(), verbose: z.literal(true) }),
        execute: () => 'mcp:everything\n  - mcp__everything__get_sum — Add two numbers'
      }),
      tool_invoke: tool({
        inputSchema: z.object({
          name: z.literal('mcp__everything__get_sum'),
          params: z.object({ a: z.literal(31415), b: z.literal(27182) })
        }),
        execute: ({ params }) => String(params.a + params.b)
      })
    },
    stopWhen: stepCountIs(4)
  })
  expect(result.text).toBe('58597')
  expect(result.steps).toHaveLength(3)
})

it('passes the listed knowledge base ID to retrieval and quotes the returned source', async () => {
  const result = await generateText({
    model: openai(),
    prompt: 'What is the regression knowledge answer? Include the exact marker and cite the source file.',
    tools: {
      kb_list: tool({
        inputSchema: z.object({}),
        execute: () => JSON.stringify({ items: [{ id: 'case-owned-base', name: 'Fixture' }] })
      }),
      kb_search: tool({
        inputSchema: z.object({ query: z.string(), baseIds: z.tuple([z.literal('case-owned-base')]) }),
        execute: () =>
          JSON.stringify([{ id: 'source-1', title: 'ground-truth.txt', content: 'CHERRY_KNOWLEDGE_58597' }])
      })
    },
    stopWhen: stepCountIs(4)
  })
  expect(result.text).toContain('CHERRY_KNOWLEDGE_58597')
  expect(result.text).toContain('ground-truth.txt')
  expect(result.text).toContain('[cite:source-1]')
  expect(result.steps).toHaveLength(3)
})

it('only acknowledges the tool settings search after receiving actual search results', async () => {
  const query = 'Cherry Studio Electron GitHub'
  const options = {
    model: openai(),
    prompt: `Call web_search exactly once with the query "${query}". Do not call web_fetch. After the tool returns, include SEARCH_COMPLETE in your answer.`,
    stopWhen: stepCountIs(3),
    maxRetries: 0
  }
  const search = (hits: { id: string; title: string; content: string }[]) => ({
    web_search: tool({
      inputSchema: z.object({ query: z.literal(query) }),
      execute: () => JSON.stringify(hits)
    })
  })
  const result = await generateText({
    ...options,
    tools: search([{ id: 'source-1', title: 'Cherry Studio', content: 'Repository' }])
  })
  expect(result.text).toBe('SEARCH_COMPLETE')
  await expect(generateText({ ...options, tools: search([]) })).rejects.toThrow()
})

it('rejects a prompt outside the reviewed scenario fixtures', async () => {
  const response = await fetch(`http://127.0.0.1:${mock.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mock-chat',
      messages: [{ role: 'user', content: 'make up an unregistered successful response' }]
    })
  })
  expect(response.status).toBe(503)
  await response.text()
})

it('reads the advertised skill location even when its storage directory is an opaque ID', async () => {
  const path = join(directory, 'opaque-install-id', 'SKILL.md')
  const result = await generateText({
    model: openai(),
    system: `<available_skills><skill><name>cherry-regression-fixture</name><location>${path}</location></skill></available_skills>`,
    prompt: 'Using the selected local skill reference, quote the Validation label field from its fixture catalog.',
    tools: {
      read: tool({
        inputSchema: z.object({ path: z.literal(path) }),
        execute: () => '| Validation label | SKILL_IMPORT_PASS |'
      })
    },
    stopWhen: stepCountIs(3)
  })
  expect(result.text).toBe('SKILL_IMPORT_PASS')
  expect(result.steps).toHaveLength(2)
})

it('loads a Claude skill through its native tool instead of guessing an installation path', async () => {
  const result = await generateText({
    model: openai(),
    system: '- cherry-regression-fixture: Local validation catalog.',
    prompt:
      'Use the cherry-regression-fixture skill. Using the selected local skill reference, quote the Validation label field from its fixture catalog.',
    tools: {
      Skill: tool({
        inputSchema: z.object({ skill: z.literal('cherry-regression-fixture') }),
        execute: () => '| Validation label | SKILL_IMPORT_PASS |'
      })
    },
    stopWhen: stepCountIs(3)
  })
  expect(result.text).toBe('SKILL_IMPORT_PASS')
  expect(result.steps).toHaveLength(2)
})

it('ends an auxiliary next-prompt prediction without executing the quoted conversation', async () => {
  const result = await generateText({
    model: openai(),
    system: 'Predict the single most likely next message the user would type after this conversation.',
    prompt: JSON.stringify([
      {
        role: 'user',
        text: 'Create the file at the exact absolute path "/never-write.txt" containing only AGENT_FILE_TASK_PASS'
      },
      { role: 'assistant', text: 'AGENT_FILE_TASK_PASS' }
    ])
  })
  expect(result.text).toBe('')
  expect(result.toolCalls).toHaveLength(0)
})

it('permits a silent native suggestion after a completed turn', async () => {
  const result = await generateText({
    model: openai(),
    messages: [
      { role: 'user', content: 'Reply with the single word OK.' },
      { role: 'assistant', content: 'OK' },
      {
        role: 'user',
        content:
          '[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]\nStay silent if the next step is unclear.'
      }
    ]
  })
  expect(result.text).toBe('')
  expect(result.toolCalls).toHaveLength(0)
})

it('detects the fixture document language from the actual system envelope instead of echoing its content', async () => {
  const result = await generateText({
    model: openai(),
    system:
      "Your task is to precisely identify the language used in the user's input text.\n<text>\nCherry regression PDF: PDF_TRANSLATION_MARKER_314159\n</text>",
    prompt: 'follow system prompt'
  })
  expect(result.text).toBe('en-us')
})
