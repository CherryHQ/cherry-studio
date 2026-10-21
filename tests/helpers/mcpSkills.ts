import { createHash } from 'node:crypto'

import { Server } from '@modelcontextprotocol/server'

import type { McpSkill } from '../../src/shared/types/mcpSkills'

/** A real protocol peer shared by wire, host and Electron acceptance tests. */
export function createMcpSkillsFixture() {
  const uri = 'skill://reports/SKILL.md'
  const files = new Map([
    [uri, '---\nname: reports\ndescription: Build a report\n---\nRead references/facts.txt and return its code.\n'],
    ['skill://reports/references/facts.txt', 'Report code: CHERRY-2640\n']
  ])
  const requests: string[] = []
  let advertise = true
  let directoryRead = false
  const additional = new Map<string, McpSkill>()
  let repeatCursor = false
  const manifest = () => ({
    uri,
    frontmatter: { name: 'reports', description: 'Build a report' },
    resources: [...files].map(([fileUri, content]) => ({
      uri: fileUri,
      size: Buffer.byteLength(content),
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`
    }))
  })
  let held = manifest()
  return {
    uri,
    files,
    requests,
    manifest: () => structuredClone(held),
    refresh() {
      held = manifest()
    },
    publish(skill: McpSkill) {
      additional.set(skill.uri, skill)
    },
    directoryRead(value: boolean) {
      directoryRead = value
    },
    advertise(value: boolean) {
      advertise = value
    },
    repeatCursor(value: boolean) {
      repeatCursor = value
    },
    createServer() {
      const server = new Server(
        { name: 'fixture', version: '1' },
        {
          capabilities: {
            resources: {},
            ...(advertise ? { extensions: { 'io.modelcontextprotocol/skills': { directoryRead } } } : {})
          }
        }
      )
      server.setRequestHandler('resources/templates/list', async () => ({
        resourceTemplates: [],
        ttlMs: 0,
        cacheScope: 'private'
      }))
      server.setRequestHandler('resources/list', async () => ({ resources: [], ttlMs: 0, cacheScope: 'private' }))
      server.setRequestHandler('resources/read', async ({ params }) => {
        requests.push(`read:${params.uri}`)
        const text = files.get(params.uri)
        if (text === undefined) throw new Error('Unknown resource')
        return { contents: [{ uri: params.uri, text }], ttlMs: 0, cacheScope: 'private' }
      })
      server.fallbackRequestHandler = async (request) => {
        requests.push(request.method)
        if (request.method === 'skills/list') {
          const second = request.params?.cursor === 'page-2'
          return {
            resultType: 'complete',
            skills: second
              ? [additional.get(uri) ?? held, ...[...additional.values()].filter((skill) => skill.uri !== uri)]
              : [],
            ...(second && !repeatCursor ? {} : { nextCursor: 'page-2' }),
            ttlMs: 0,
            cacheScope: 'private'
          }
        }
        if (request.method === 'skills/get') {
          const skill = additional.get(String(request.params?.uri)) ?? (request.params?.uri === uri ? held : undefined)
          if (skill) return { resultType: 'complete', skill, ttlMs: 0, cacheScope: 'private' }
        }
        if (request.method === 'resources/directory/read' && directoryRead) {
          const second = request.params?.cursor === 'files'
          return {
            resultType: 'complete',
            resources: second ? [{ uri, name: 'SKILL.md', mimeType: 'text/markdown' }] : [],
            ...(second ? {} : { nextCursor: 'files' }),
            ttlMs: 0,
            cacheScope: 'private'
          }
        }
        throw new Error('Unknown extension request')
      }
      return server
    }
  }
}
