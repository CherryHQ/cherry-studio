/**
 * `tool_invoke` meta-tool — dispatches a tool by name through the registry.
 * The LLM uses this together with `tool_search` / `tool_inspect`: search to
 * discover, inspect to confirm parameters, invoke to call.
 *
 * Two guards keep the model from guessing arguments blindly — both reject by
 * handing back the tool signature, so the model self-corrects with "call, fix,
 * retry" without being told up front it must inspect:
 *   A. unseen-schema guard — the first invoke of a tool whose signature the
 *      model hasn't seen is rejected with that signature; the name is then
 *      recorded so the corrected retry passes (no inspect loop). This is the
 *      only protection for `jsonSchema()`-wrapped tools (e.g. MCP), where B is a no-op.
 *   B. param validation — arguments are validated against the tool input
 *      schema; a mismatch is rejected with the signature. (Tools backed by a
 *      `jsonSchema()`-wrapped schema (e.g. MCP) carry no validator, so B is a
 *      no-op for them — same as the SDK's native dispatch path.)
 *
 * Forwards the AI SDK execution options (messages, abortSignal,
 * experimental_context) onto the inner tool's `execute` so the per-request
 * RequestContext flows through. The inner `toolCallId` is suffixed with the
 * target name so telemetry can rebuild the call tree.
 */

import { asSchema, type Tool, tool } from 'ai'
import * as z from 'zod'

import { isApprovalGated } from '../isApprovalGated'
import type { ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { buildToolStub } from './schemaStub'

export const TOOL_INVOKE_TOOL_NAME = 'tool_invoke'

/**
 * @param allowedNames per-request tool name set (the request's active inline ∪ deferred names).
 *   `tool_invoke` resolves against the process-wide registry, so without this scope a model could
 *   reach user-owned tools that `applies()` excluded for this request. Closed over here exactly as
 *   `tool_search` closes over its deferred set. The approval gate below is enforced regardless.
 * @param inspectedNames shared per-request set of tools whose signature the model has been shown
 *   (via `tool_inspect` or a prior rejection here). Drives Guard A, the unseen-schema guard.
 */
export function createToolInvokeTool(
  registry: ToolRegistry,
  allowedNames: ReadonlySet<string>,
  inspectedNames: Set<string>
): Tool {
  // Per-request cache of the Guard-B-parsed params keyed by the tool_invoke call id, so the
  // `toModelOutput` hook below can feed the inner formatter the SAME input `execute` ran on
  // (defaults / coercions applied) — native dispatch keeps execute's and toModelOutput's input
  // identical, and the inner formatter (e.g. kb_list) keys its output off those params.
  const parsedParamsByCallId = new Map<string, Record<string, unknown>>()
  return tool({
    description:
      'Call a single tool discovered via `tool_search` by name, passing arguments under `params`. ' +
      "If the tool hasn't been inspected, or the arguments don't match its schema, the call returns the " +
      'tool signature — read it and call again with corrected params. Inspect first to skip that round-trip.',
    inputSchema: z.object({
      name: z.string().describe('Tool name as returned by tool_search'),
      params: z.record(z.string(), z.unknown()).optional().describe('Tool input arguments')
    }),
    inputExamples: [{ input: { name: 'web_search', params: { query: 'cherry studio latest release' } } }],
    execute: async ({ name, params }, options) => {
      if (!allowedNames.has(name)) throw new Error(`Tool not available in this request: ${name}`)
      const entry = registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      if (typeof entry.tool.execute !== 'function') {
        throw new Error(`Tool ${name} has no execute handler`)
      }
      // Enforce the approval gate at the registry execution boundary. The SDK's native
      // `needsApproval` check only fires for tools it dispatches itself; a tool reached through
      // this meta-tool would otherwise bypass it. Approval-gated tools are kept inline (see
      // `applyDeferExposition`), so refusing here just steers the model to call them directly.
      if (
        await isApprovalGated(entry.tool, {
          input: params ?? {},
          toolCallId: options.toolCallId,
          messages: options.messages,
          experimental_context: options.experimental_context
        })
      ) {
        throw new Error(`Tool "${name}" requires user approval; call it directly instead of via tool_invoke.`)
      }

      // Guard A: hand back the signature before running a tool whose schema the model hasn't seen,
      // so it can't execute on blindly-guessed params. Record the name first so the rejection's
      // signature is enough to retry — the schema is already in hand, re-inspecting would waste a
      // round-trip. Not advertised as a hard rule; it's the safety net behind "call, fix, retry".
      if (!inspectedNames.has(name)) {
        inspectedNames.add(name)
        const stub = await buildToolStub(entry)
        throw new Error(
          `Tool "${name}" hasn't been inspected yet — its signature is below. Call tool_invoke again with params matching it:\n\n${stub}`
        )
      }

      // Guard B: validate params against the tool input schema.
      const finalParams = await validateParams(entry, params ?? {})
      parsedParamsByCallId.set(options.toolCallId, finalParams)

      return entry.tool.execute(finalParams, {
        ...options,
        toolCallId: `${options.toolCallId}::${name}`
      })
    },
    // Present the inner tool's result to the model exactly as a native dispatch would: delegate to
    // the inner tool's `toModelOutput` (e.g. MCP summarises its full response to text). Without this
    // the model sees `tool_invoke`'s raw JSON return — the inner formatter is otherwise bypassed.
    toModelOutput: ({ toolCallId, input, output }) => {
      const entry = allowedNames.has(input.name) ? registry.getByName(input.name) : undefined
      const innerToModelOutput = entry?.tool.toModelOutput
      if (innerToModelOutput) {
        // Feed the inner formatter the parsed params `execute` ran on, not the raw `input.params`,
        // so its view matches native dispatch. Falls back to raw input if no parse was recorded.
        const innerInput = parsedParamsByCallId.get(toolCallId) ?? input.params ?? {}
        return innerToModelOutput({ toolCallId: `${toolCallId}::${input.name}`, input: innerInput, output })
      }
      return { type: 'json', value: output }
    }
  })
}

/**
 * Validate `params` against the tool input schema, returning the parsed value
 * (Zod defaults/coercions applied) on success. Throws with the tool signature
 * on mismatch. Schemas without a validator (`jsonSchema()`-wrapped, e.g. MCP
 * tools) pass through unchanged — Guard A is their protection.
 */
async function validateParams(entry: ToolEntry, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const validate = asSchema(entry.tool.inputSchema as Parameters<typeof asSchema>[0]).validate
  if (!validate) return params

  const result = await validate(params)
  if (result.success) return result.value as Record<string, unknown>

  const stub = await buildToolStub(entry)
  throw new Error(`Invalid params for "${entry.name}": ${result.error.message}\n\nExpected signature:\n${stub}`)
}
