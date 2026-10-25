#!/usr/bin/env node
/**
 * Minimal stdio MCP server used by MP-36 (MCP prompts and resources catalog).
 *
 * The case needs a server that exposes exactly one prompt with a required
 * argument and exactly one readable resource, plus an `--empty` variant that
 * exposes neither so the empty-state feedback of the composer catalogs can be
 * verified. It has no dependencies so the case can spawn it with the same Node
 * binary that runs the regression suite.
 *
 * Usage: node mcpPromptResourceServer.mjs [--empty]
 * Env:   MP36_RESOURCE_CODE - text returned by resources/read
 */

const EMPTY_CATALOG = process.argv.includes('--empty')
const RESOURCE_CODE = process.env.MP36_RESOURCE_CODE ?? 'MP36-UNSET'

const PROMPT = {
  name: 'mp36-uppercase',
  description: 'Convert the supplied value to uppercase.',
  arguments: [{ name: 'value', description: 'Text value to convert', required: true }]
}

const RESOURCE = {
  uri: 'mp36://project/brief',
  name: 'MP36 project reference',
  description: 'Project brief with the verification code for this run',
  mimeType: 'text/plain'
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handle(message) {
  const { id, method, params } = message
  const request = id !== undefined && id !== null
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: {
          prompts: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          tools: { listChanged: false }
        },
        serverInfo: { name: 'mp36-catalog', version: '1.0.0' }
      })
      return
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return
    case 'ping':
      reply(id, {})
      return
    case 'prompts/list':
      reply(id, { prompts: EMPTY_CATALOG ? [] : [PROMPT] })
      return
    case 'prompts/get': {
      if (EMPTY_CATALOG || params?.name !== PROMPT.name) {
        fail(id, -32602, `Unknown prompt: ${String(params?.name)}`)
        return
      }
      const value = String(params?.arguments?.value ?? '')
      reply(id, {
        description: PROMPT.description,
        messages: [{ role: 'user', content: { type: 'text', text: `Convert "${value}" to uppercase.` } }]
      })
      return
    }
    case 'resources/list':
      reply(id, { resources: EMPTY_CATALOG ? [] : [RESOURCE] })
      return
    case 'resources/templates/list':
      reply(id, { resourceTemplates: [] })
      return
    case 'resources/read': {
      if (EMPTY_CATALOG || params?.uri !== RESOURCE.uri) {
        fail(id, -32602, `Unknown resource: ${String(params?.uri)}`)
        return
      }
      reply(id, { contents: [{ uri: RESOURCE.uri, mimeType: RESOURCE.mimeType, text: RESOURCE_CODE }] })
      return
    }
    case 'tools/list':
      reply(id, { tools: [] })
      return
    default:
      // Notifications carry no id and must never be answered.
      if (request) fail(id, -32601, `Method not supported: ${String(method)}`)
  }
}

let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffered += chunk
  let newline = buffered.indexOf('\n')
  while (newline >= 0) {
    const line = buffered.slice(0, newline).trim()
    buffered = buffered.slice(newline + 1)
    if (line) {
      try {
        handle(JSON.parse(line))
      } catch {
        // A malformed frame must not take the server down; the client will retry.
      }
    }
    newline = buffered.indexOf('\n')
  }
})
