import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { PnpmNodeModulesCollector } = builderRequire(
  'app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector'
)
const { TmpDir } = builderRequire('temp-file')
const { satisfies } = builderRequire('semver')

type CollectedModule = { name: string; version: string; dir: string; dependencies?: CollectedModule[] }

function packageRequire(name: string, from: NodeJS.Require): NodeJS.Require {
  const directory = from.resolve
    .paths(name)
    ?.find((directory) => existsSync(path.join(directory, name, 'package.json')))
  if (!directory) throw new Error(`Missing dependency: ${name}`)
  return createRequire(realpathSync(path.join(directory, name, 'package.json')))
}

const piRequire = packageRequire('@earendil-works/pi-ai', require)

describe('packaged Smithy dependencies', () => {
  it('preserves S3 request signing and response decoding for backups', async () => {
    const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3')
    let authorization = ''
    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      requestHandler: {
        handle: async (request: { headers: Record<string, string> }) => {
          authorization = request.headers.authorization
          return {
            response: {
              statusCode: 200,
              headers: { 'content-type': 'application/xml' },
              body: new TextEncoder().encode(
                '<ListAllMyBucketsResult><Buckets><Bucket><Name>backups</Name></Bucket></Buckets></ListAllMyBucketsResult>'
              )
            }
          }
        }
      }
    })
    try {
      const response = await client.send(new ListBucketsCommand({}))
      expect(response.Buckets).toEqual([{ Name: 'backups' }])
      expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\//)
    } finally {
      client.destroy()
    }
  })

  it('collects one compatible Smithy core for all production consumers', async () => {
    const temporaryDirectory = new TmpDir()
    try {
      const { nodeModules } = await new PnpmNodeModulesCollector(projectRoot, temporaryDirectory).getNodeModules({
        packageName: 'CherryStudio'
      })
      const modules: CollectedModule[] = []
      const visit = (nodes: CollectedModule[]) => {
        for (const node of nodes) {
          modules.push(node)
          visit(node.dependencies ?? [])
        }
      }
      visit(nodeModules)
      const cores = modules.filter((node) => node.name === '@smithy/core')
      expect(cores).toHaveLength(1)
      let consumers = 0
      for (const node of modules) {
        const manifest = JSON.parse(readFileSync(path.join(node.dir, 'package.json'), 'utf8'))
        const range = manifest.dependencies?.['@smithy/core']
        if (!range) continue
        consumers++
        expect(satisfies(cores[0].version, range), `${node.name}: ${range}`).toBe(true)
      }
      expect(consumers).toBeGreaterThan(0)
    } finally {
      await temporaryDirectory.cleanup()
    }
  }, 60_000)

  it.each([['Pi', piRequire]] as const)(
    'signs and decodes a Bedrock request through the %s dependency tree',
    async (_name, runtimeRequire) => {
      const { BedrockRuntimeClient, ConverseCommand } = runtimeRequire('@aws-sdk/client-bedrock-runtime')
      const requests: { headers: Record<string, string>; body: string }[] = []
      const client = new BedrockRuntimeClient({
        region: 'us-east-1',
        credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
        requestHandler: {
          handle: async (request: { headers: Record<string, string>; body: string }) => {
            requests.push(request)
            return {
              response: {
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                body: new TextEncoder().encode(
                  JSON.stringify({
                    output: { message: { role: 'assistant', content: [{ text: 'packaging verified' }] } },
                    stopReason: 'end_turn',
                    usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
                    metrics: { latencyMs: 1 }
                  })
                )
              }
            }
          }
        }
      })
      try {
        const response = await client.send(
          new ConverseCommand({ modelId: 'test-model', messages: [{ role: 'user', content: [{ text: 'hello' }] }] })
        )
        expect(response.output.message.content).toEqual([{ text: 'packaging verified' }])
        expect(response.usage.totalTokens).toBe(6)
        expect(requests).toHaveLength(1)
        expect(JSON.parse(requests[0].body).messages).toEqual([{ role: 'user', content: [{ text: 'hello' }] }])
        expect(requests[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\//)
      } finally {
        client.destroy()
      }
    }
  )
})
