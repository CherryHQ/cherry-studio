#!/usr/bin/env node
const INSTANCE = process.env.MP24065_INSTANCE ?? 'unset'

const TOOL = {
  name: 'mp24065_echo',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function handle(message) {
  const { id, method, params } = message
  if (id === undefined || id === null) return
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mp24065-arming', version: `1.0.0-${INSTANCE}` }
      })
      return
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: [TOOL] })
      return
    case 'tools/call':
      if (params?.name === TOOL.name && typeof params?.arguments?.text === 'string') {
        reply(id, { content: [{ type: 'text', text: params.arguments.text }] })
        return
      }
  }
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not supported: ${String(method)}` } })}\n`
  )
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
