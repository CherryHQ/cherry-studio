import { afterEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@cherrystudio/provider-registry'

import {
  accountPlansSchema,
  cloudModelListSchema,
  createDesktopAuthorizationResponseSchema,
  exchangeDesktopAuthorizationResponseSchema,
  refreshProductSessionResponseSchema
} from '../contracts'

const expiresAt = '2026-08-28T00:00:00.000Z'
const token = 'A'.repeat(43)
const tokenSet = {
  token_type: 'Bearer',
  access_token: token,
  expires_in: 3600,
  refresh_token: token,
  session_id: '00000000-0000-4000-8000-000000000001',
  session_expires_at: expiresAt,
  token_metadata: { scope: 'work' }
}

describe('Cherry Cloud response contracts', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts plain HTTP authorization only on the configured development origin', () => {
    const authorization = (url: string) =>
      createDesktopAuthorizationResponseSchema.safeParse({
        authorization_id: '00000000-0000-4000-8000-000000000001',
        authorization_url: url,
        expires_at: expiresAt
      }).success

    vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', '')
    expect(authorization('http://192.168.1.176:8284/authorize')).toBe(false)

    vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', 'http://192.168.1.176:8284')

    expect(authorization('http://192.168.1.176:8284/authorize')).toBe(true)
    expect(authorization('http://192.168.1.176:9999/authorize')).toBe(false)
    expect(authorization('http://evil.example/authorize')).toBe(false)
  })

  it('accepts additional server fields', () => {
    expect(
      createDesktopAuthorizationResponseSchema.safeParse({
        authorization_id: '00000000-0000-4000-8000-000000000001',
        authorization_url: 'https://cloud.cherryai.com.cn/authorize',
        expires_at: expiresAt,
        authorization_metadata: { theme: 'default' }
      }).success
    ).toBe(true)

    expect(
      exchangeDesktopAuthorizationResponseSchema.safeParse({
        token_set: tokenSet,
        account: {
          account: { id: '00000000-0000-4000-8000-000000000002' },
          session: { id: '00000000-0000-4000-8000-000000000001', expires_at: expiresAt },
          device: { id: '00000000-0000-4000-8000-000000000003' },
          account_metadata: { region: 'cn' }
        },
        exchange_metadata: { issued_by: 'desktop' }
      }).success
    ).toBe(true)

    expect(
      refreshProductSessionResponseSchema.safeParse({
        token_set: tokenSet,
        refresh_metadata: { rotated: true }
      }).success
    ).toBe(true)

    expect(
      cloudModelListSchema.safeParse({
        data: [
          {
            id: 'claude-test',
            display_name: 'Claude Test',
            endpoint_type: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
            context_window: 200_000,
            max_output_tokens: 8_192,
            capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
            available_features: ['agent'],
            model_metadata: { tier: 'work' }
          }
        ],
        has_more: false
      }).success
    ).toBe(true)
  })

  it('accepts the China backend billing-period quota window', () => {
    expect(
      accountPlansSchema.safeParse({
        measured_at: expiresAt,
        available_plans: [],
        entitlements: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            source: 'billing',
            plan: {
              id: '00000000-0000-4000-8000-000000000011',
              display_name: 'Plus',
              is_free: false,
              default_for_new_accounts: false,
              quota_pool_count: 1,
              model_count: 1,
              purchase_available: false
            },
            state: 'active',
            starts_at: expiresAt,
            quota_pools: [
              {
                allocation_id: '00000000-0000-4000-8000-000000000012',
                display_name: 'Plus',
                measurement_kind: 'requests',
                model_ids: ['cn-model'],
                windows: [
                  {
                    window_type: 'subscription_month',
                    duration_seconds: 2_678_400,
                    limit_units: 100,
                    used_units: 0,
                    active_reserved_units: 0,
                    remaining_units: 100,
                    period_start: expiresAt,
                    period_end: expiresAt
                  }
                ]
              }
            ]
          }
        ]
      }).success
    ).toBe(true)
  })

  it('still rejects responses missing required fields', () => {
    expect(
      createDesktopAuthorizationResponseSchema.safeParse({
        authorization_id: '00000000-0000-4000-8000-000000000001',
        authorization_url: 'https://cloud.cherryai.com.cn/authorize'
      }).success
    ).toBe(false)
    expect(cloudModelListSchema.safeParse({ has_more: false }).success).toBe(false)
    expect(
      cloudModelListSchema.safeParse({
        data: [
          {
            id: 'claude-test',
            display_name: 'Claude Test',
            context_window: 200_000,
            max_output_tokens: 8_192
          }
        ]
      }).success
    ).toBe(false)
  })

  it('preserves missing capabilities for client fallback and ignores unknown capability values', () => {
    const model = {
      id: 'claude-test',
      display_name: 'Claude Test',
      endpoint_type: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      context_window: 200_000,
      max_output_tokens: 8_192,
      available_features: ['agent']
    }

    expect(cloudModelListSchema.parse({ data: [model] }).data[0].capabilities).toBeUndefined()
    expect(
      cloudModelListSchema.parse({
        data: [{ ...model, capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, 'future-capability'] }]
      }).data[0].capabilities
    ).toEqual([MODEL_CAPABILITY.FUNCTION_CALL])
    expect(cloudModelListSchema.safeParse({ data: [{ ...model, capabilities: null }] }).success).toBe(false)
    expect(
      cloudModelListSchema.safeParse({
        data: [{ ...model, capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, 1] }]
      }).success
    ).toBe(false)
  })

  it('rejects model IDs that cannot be encoded as a UniqueModelId', () => {
    const model = {
      display_name: 'Claude Test',
      endpoint_type: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      context_window: 200_000,
      max_output_tokens: 8_192,
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
      available_features: ['agent']
    }

    expect(cloudModelListSchema.safeParse({ data: [{ ...model, id: 'claude?test' }] }).success).toBe(false)
    expect(cloudModelListSchema.safeParse({ data: [{ ...model, id: 'claude#test' }] }).success).toBe(false)
  })
})
