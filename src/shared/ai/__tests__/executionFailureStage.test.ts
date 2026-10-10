/**
 * Every terminal failure must name the pipeline stage it happened in, so a user
 * can tell "retry it" from "fix your account". These three surfaced as bare
 * strings that identified neither cause nor stage (#20941 expected result).
 */

import { describe, expect, it } from 'vitest'

import { executionFailureSchema } from '@cherrystudio/remote-protocol/failure'

import { toExecutionFailure, toWireExecutionFailure } from '../executionFailure'

const SSE_QUOTA_FRAME =
  'API Error: Request rejected (429) · event:error data:{"type":"error","error":{"type":"rate_limit_error","message":"You exceeded your current quota."}}'

describe('execution failure — pipeline stage', () => {
  it('names the parse stage for AI SDK "Failed to process successful response"', () => {
    // A 2xx body the client could not decode; the provider never failed.
    const failure = toExecutionFailure({
      name: 'APICallError',
      message: 'Failed to process successful response',
      stack: null,
      statusCode: 200
    })
    expect(failure.failure.stage).toBe('parse')
  })

  it('names the runtime stage for a bare "No response"', () => {
    const failure = toExecutionFailure({
      name: 'AgentRuntimeError',
      message: 'No response',
      stack: null
    })
    expect(failure.failure.stage).toBe('runtime')
  })

  it('names the runtime stage for pi-ai "An unknown error occurred"', () => {
    const failure = toExecutionFailure({
      name: 'Error',
      message: 'An unknown error occurred',
      stack: null
    })
    expect(failure.failure.stage).toBe('runtime')
  })

  it('names the persistence stage when storing the turn failed', () => {
    const failure = toExecutionFailure(
      { name: 'Error', message: 'SQLITE_BUSY: database is locked', stack: null },
      'openai::gpt-4o',
      'host'
    )
    expect(failure.failure.stage).toBe('persistence')
  })

  it('names the http stage when the provider answered with an error status', () => {
    const failure = toExecutionFailure({
      name: 'APICallError',
      message: 'Provider returned error',
      stack: null,
      statusCode: 403
    })
    expect(failure.failure.stage).toBe('http')
  })

  it('does not mistake an HTTP quota rejection for a transport or runtime failure', () => {
    // Billing signals arrive as 402/429 responses: the request reached the provider.
    const failure = toExecutionFailure({
      name: 'APICallError',
      message: 'Insufficient balance',
      stack: null,
      statusCode: 402
    })
    expect(failure.failure.stage).toBe('http')
    expect(failure.failure.reasonCode).toBe('quota')
  })

  it('leaves the stage unknown rather than guessing when nothing identifies it', () => {
    const failure = toExecutionFailure({ name: 'Error', message: 'Insufficient balance', stack: null })
    expect(failure.failure.stage).toBe('unknown')
    expect(failure.failure.reasonCode).toBe('quota')
  })

  it('honours a stage the caller already attributed', () => {
    const failure = toExecutionFailure({
      name: 'Error',
      message: 'boom',
      stack: null,
      failureStage: 'transport'
    })
    expect(failure.failure.stage).toBe('transport')
  })

  it('keeps older failures without a stage parseable', () => {
    const failure = toExecutionFailure({
      name: 'Error',
      message: 'legacy',
      stack: null,
      executionFailure: {
        message: 'legacy',
        retryable: false,
        failure: { version: 1, reasonCode: 'unknown', source: { layer: 'runtime' } }
      }
    })
    expect(failure.failure.stage).toBeUndefined()
  })
})

describe('execution failure — v1 wire contract', () => {
  it('keeps the strict v1 schema rejecting stage-bearing snapshots', () => {
    // Deployed peers parse failures with the v1 strict schema; a snapshot carrying
    // `stage` makes them drop the whole event batch or checkpoint. This is why the
    // remote boundary projects the stage away while `agentFailureVersion` stays 1.
    const persisted = toExecutionFailure({
      name: 'APICallError',
      message: 'Provider returned error',
      stack: null,
      statusCode: 403
    })
    expect(persisted.failure.stage).toBe('http')
    expect(executionFailureSchema.safeParse(persisted).success).toBe(false)
  })

  it('projects a persisted failure onto a snapshot the v1 schema accepts', () => {
    const persisted = toExecutionFailure({
      name: 'APICallError',
      message: 'Provider returned error',
      stack: null,
      statusCode: 403
    })
    const wire = toWireExecutionFailure(persisted)
    expect(wire.failure).not.toHaveProperty('stage')
    expect(executionFailureSchema.safeParse(wire).success).toBe(true)
  })

  it('round-trips a stored stage-bearing failure without re-deriving it', () => {
    const failure = toExecutionFailure({
      name: 'Error',
      message: 'stored',
      stack: null,
      executionFailure: {
        message: 'stored',
        retryable: false,
        failure: { version: 1, reasonCode: 'quota', source: { layer: 'provider' }, stage: 'http' }
      }
    })
    expect(failure.failure.stage).toBe('http')
  })
})

describe('execution failure — SSE frame residue', () => {
  it("projects the frame's provider message, not the protocol scaffolding", () => {
    const failure = toExecutionFailure({
      name: 'StreamError',
      message: SSE_QUOTA_FRAME,
      stack: null
    })

    expect(failure.message).toBe('You exceeded your current quota.')
    // The user must never see SSE syntax.
    expect(JSON.stringify(failure)).not.toMatch(/event:|data:\s*\{/)
  })

  it('still classifies a framed quota failure as quota', () => {
    const failure = toExecutionFailure({ name: 'StreamError', message: SSE_QUOTA_FRAME, stack: null })
    expect(failure.failure.reasonCode).toBe('quota')
    expect(failure.failure.source.layer).toBe('provider')
  })

  it('attributes an in-stream error frame to the stream stage', () => {
    const failure = toExecutionFailure({ name: 'StreamError', message: SSE_QUOTA_FRAME, stack: null })
    expect(failure.failure.stage).toBe('stream')
  })

  it('does not truncate a normal provider message', () => {
    const failure = toExecutionFailure({
      name: 'APICallError',
      message: 'Model gpt-5 does not exist',
      stack: null,
      statusCode: 404
    })
    expect(failure.message).toBe('Model gpt-5 does not exist')
  })
})
