import { describe, expect, it } from 'vitest'

import { mcpRequestSchemas } from '../mcp'

const origin = { serverId: 'docs', serverName: 'Documents' }

describe('MCP catalog IPC schemas', () => {
  it('validates resource templates as a catalog array with server attribution', () => {
    const output = mcpRequestSchemas['mcp.server.list_resource_templates'].output
    const template = { ...origin, name: 'document', uriTemplate: 'docs://documents/{id}' }
    expect(output.parse([template])).toEqual([template])
    expect(output.safeParse({ resourceTemplates: [template] }).success).toBe(false)
    expect(output.safeParse([{ ...origin, name: 'document', uri: 'docs://documents/1' }]).success).toBe(false)
    expect(output.safeParse([{ name: 'document', uriTemplate: 'docs://documents/{id}' }]).success).toBe(false)
  })

  it('rejects malformed prompt and resource fields instead of passing untyped payloads', () => {
    const prompts = mcpRequestSchemas['mcp.server.list_prompts'].output
    const resources = mcpRequestSchemas['mcp.server.list_resources'].output
    const prompt = { ...origin, id: 'prompt', name: 'explain', arguments: [{ name: 'subject', required: true }] }
    const resource = { ...origin, name: 'document', uri: 'docs://documents/1', size: 42 }
    expect(prompts.parse([prompt])).toEqual([prompt])
    expect(resources.parse([resource])).toEqual([resource])
    expect(prompts.safeParse([{ ...prompt, arguments: [{ name: 'subject', required: 'yes' }] }]).success).toBe(false)
    expect(resources.safeParse([{ ...resource, uri: 42 }]).success).toBe(false)
  })

  it('requires string prompt arguments and SDK-valid prompt messages', () => {
    const route = mcpRequestSchemas['mcp.server.get_prompt']
    expect(route.input.safeParse({ serverId: 'docs', name: 'explain', args: { subject: 'MCP' } }).success).toBe(true)
    expect(route.input.safeParse({ serverId: 'docs', name: 'explain', args: { subject: 42 } }).success).toBe(false)
    const result = { messages: [{ role: 'user', content: { type: 'text', text: 'Explain MCP' } }] }
    expect(route.output.parse(result)).toEqual(result)
    expect(route.output.safeParse({ messages: [{ role: 'user', content: { type: 'text' } }] }).success).toBe(false)
  })
})
