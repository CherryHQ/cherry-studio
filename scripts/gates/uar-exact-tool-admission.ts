import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { createUarHostMcpBridge } from '../../src/main/ai/runtime/uar/UarHostMcpBridge'
import {
  UAR_TOOL_ADMISSION_META_KEY,
  UAR_TOOL_ADMISSION_VERSION,
  type UarHostToolDisposition
} from '../../src/main/ai/runtime/uar/UarHostToolAdmission'

type JsonRecord = Record<string, unknown>
type MatrixResult = { host: UarHostToolDisposition; local: 'auto' | 'ask' | 'deny'; result: string }

const ownerId = 'gate-a1-owner'
const workspace = '/gate-a1/workspace'

async function main(): Promise<void> {
  let hostDisposition: UarHostToolDisposition = 'auto'
  let observedEffects = 0
  const filesystem = createFilesystemServer(() => {
    observedEffects += 1
  })
  const bridge = await createUarHostMcpBridge(
    { filesystem: { name: 'filesystem', instance: filesystem } },
    { ownerId, workspace, disposition: () => hostDisposition }
  )
  const mounted = bridge.servers[0]
  assert(mounted)
  const client = new Client({ name: 'gate-a1', version: '1.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(mounted.url), {
    requestInit: { headers: mounted.headers }
  })

  try {
    await client.connect(transport)
    let ordinal = 0
    const invocation = (
      argumentsValue: JsonRecord = { path: '/gate-a1/workspace/file.txt', content: 'protected' }
    ): JsonRecord => {
      ordinal += 1
      return {
        version: UAR_TOOL_ADMISSION_VERSION,
        invocationId: `gate-a1-invocation-${ordinal}`,
        modelToolCallId: `model-call-${ordinal}`,
        attempt: 1,
        rootRunId: 'gate-a1-root',
        executingRunId: 'gate-a1-root',
        ownerId,
        workspace,
        runtimeEpoch: 'gate-a1-runtime',
        hostEpoch: bridge.toolAdmission.hostEpoch,
        catalogRevision: 'catalog-v1',
        mountedServerId: 'filesystem',
        nativeToolName: 'write_file',
        providerToolName: 'filesystem__write_file',
        runPolicyRevision: 'run-policy-v1',
        toolPolicyRevision: 'tool-policy-v1',
        approvalClass: 'not_required',
        callIndex: ordinal,
        validatedArguments: argumentsValue
      }
    }
    const post = async (operation: string, body: JsonRecord): Promise<{ status: number; body: JsonRecord }> => {
      const response = await fetch(`${bridge.toolAdmission.url}/${operation}`, {
        method: 'POST',
        headers: { ...bridge.toolAdmission.headers, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      return { status: response.status, body: (await response.json()) as JsonRecord }
    }
    const prepare = async (value: JsonRecord): Promise<JsonRecord> => {
      const result = await post('prepare', { invocation: value })
      assert.equal(result.status, 200)
      assert.equal(result.body.invocationId, value.invocationId)
      assert.equal(result.body.hostEpoch, bridge.toolAdmission.hostEpoch)
      assert(!JSON.stringify(result.body.actionDisplay).includes('protected'))
      return result.body
    }
    const resolve = (
      prepared: JsonRecord,
      localDisposition: 'allowed' | 'approved' | 'denied',
      approved: boolean
    ): Promise<{ status: number; body: JsonRecord }> =>
      post('resolve', {
        admissionId: prepared.admissionId,
        invocationId: prepared.invocationId,
        localDisposition,
        approved
      })
    const callManaged = (prepared: JsonRecord, value: JsonRecord) =>
      client.callTool({
        name: 'write_file',
        arguments: value,
        _meta: {
          [UAR_TOOL_ADMISSION_META_KEY]: {
            version: UAR_TOOL_ADMISSION_VERSION,
            admissionId: prepared.admissionId,
            invocationId: prepared.invocationId,
            runtimeEpoch: 'gate-a1-runtime',
            hostEpoch: bridge.toolAdmission.hostEpoch
          }
        }
      })

    const matrix: MatrixResult[] = []
    for (const host of ['auto', 'ask', 'deny'] as const) {
      for (const local of ['auto', 'ask', 'deny'] as const) {
        hostDisposition = host
        const prepared = await prepare(invocation())
        if (host === 'deny') {
          assert.equal(prepared.hostDisposition, 'deny')
          matrix.push({ host, local, result: 'denied' })
          continue
        }
        if (local === 'deny') {
          const denied = await resolve(prepared, 'denied', false)
          assert.equal(denied.status, 200)
          assert.equal(denied.body.state, 'denied')
          matrix.push({ host, local, result: 'denied' })
          continue
        }
        const needsHuman = host === 'ask' || local === 'ask'
        if (needsHuman) assert(bridge.recordHumanDecision(String(prepared.admissionId), true))
        const authorized = await resolve(prepared, needsHuman ? 'approved' : 'allowed', true)
        assert.equal(authorized.status, 200)
        assert.equal(authorized.body.admissionId, prepared.admissionId)
        matrix.push({ host, local, result: needsHuman ? 'approved' : 'authorized' })
      }
    }

    hostDisposition = 'auto'
    const identicalArguments = { path: '/gate-a1/workspace/same.txt', content: 'same' }
    const first = await prepare(invocation(identicalArguments))
    const second = await prepare(invocation(identicalArguments))
    assert.notEqual(first.admissionId, second.admissionId)
    assert.equal((await resolve(first, 'allowed', true)).status, 200)
    assert.equal((await resolve(second, 'allowed', true)).status, 200)
    await callManaged(first, identicalArguments)
    assert.equal(observedEffects, 1)
    await assert.rejects(() => callManaged(first, identicalArguments))
    await callManaged(second, identicalArguments)
    assert.equal(observedEffects, 2)

    const mismatchArguments = { path: '/gate-a1/workspace/mismatch.txt', content: 'original' }
    const mismatch = await prepare(invocation(mismatchArguments))
    assert.equal((await resolve(mismatch, 'allowed', true)).status, 200)
    await assert.rejects(() =>
      callManaged(mismatch, { path: '/gate-a1/workspace/mismatch.txt', content: 'changed' })
    )
    await assert.rejects(() => client.callTool({ name: 'write_file', arguments: {} }))

    const batch = await fetch(mounted.url, {
      method: 'POST',
      headers: {
        ...mounted.headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 'batch', method: 'tools/call', params: {} }])
    })
    assert.match(await batch.text(), /Batch tools\/call is not supported/)

    const incompatible = invocation()
    incompatible.version = 2
    assert.equal((await post('prepare', { invocation: incompatible })).status, 422)

    const report = {
      gate: 'A1',
      protocolVersion: UAR_TOOL_ADMISSION_VERSION,
      productionBridge: true,
      matrix,
      identicalCalls: { distinctAdmissions: true, replayRejected: true },
      mismatchRejected: true,
      identityFreeRejected: true,
      batchRejected: true,
      incompatibleVersionRejected: true,
      safeProjection: true,
      toolEffectObserved: true
    }
    const evidencePath = process.argv[2]
    if (evidencePath) {
      await mkdir(dirname(evidencePath), { recursive: true })
      await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }
    console.log(JSON.stringify(report))
  } finally {
    await Promise.allSettled([client.close(), bridge.close()])
  }
}

function createFilesystemServer(onEffect: () => void): McpServer {
  const server = new McpServer({ name: 'filesystem', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'write_file',
        description: 'Gate A1 filesystem effect',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content']
        }
      }
    ]
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    onEffect()
    return { content: [{ type: 'text', text: JSON.stringify({ wrote: request.params.arguments?.path }) }] }
  })
  return server
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
