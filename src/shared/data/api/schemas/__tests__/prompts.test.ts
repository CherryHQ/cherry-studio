import { describe, expect, it } from 'vitest'

import { PROMPT_CONTENT_MAX, PROMPT_TITLE_MAX } from '../../../types/prompt'
import {
  CreatePromptSchema,
  ListPromptsQuerySchema,
  PromptBindingParamsSchema,
  PromptBindingTargetParamsSchema,
  UpdatePromptSchema
} from '../prompts'

const PROMPT_ID = '550e8400-e29b-41d4-a716-446655440000'
const TARGET_ID = '550e8400-e29b-41d4-a716-446655440001'

describe('prompt DTO schemas', () => {
  it('accepts create with title, content, and visibility', () => {
    const result = CreatePromptSchema.parse({
      title: 'Test',
      content: 'Hello',
      visibility: 'global'
    })

    expect(result).toEqual({ title: 'Test', content: 'Hello', visibility: 'global' })
  })

  it('rejects create with empty title or content or a missing visibility', () => {
    expect(() => CreatePromptSchema.parse({ title: '', content: 'Hello', visibility: 'global' })).toThrow()
    expect(() => CreatePromptSchema.parse({ title: 'Test', content: '', visibility: 'global' })).toThrow()
    expect(() => CreatePromptSchema.parse({ title: 'Test', content: 'Hello' })).toThrow()
  })

  it('rejects create values over schema limits', () => {
    expect(() =>
      CreatePromptSchema.parse({ title: 'x'.repeat(PROMPT_TITLE_MAX + 1), content: 'Hello', visibility: 'global' })
    ).toThrow()
    expect(() =>
      CreatePromptSchema.parse({ title: 'Test', content: 'x'.repeat(PROMPT_CONTENT_MAX + 1), visibility: 'global' })
    ).toThrow()
  })

  it('rejects create with unknown prompt fields', () => {
    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        currentVersion: 1,
        visibility: 'global'
      })
    ).toThrow()

    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        visibility: 'global',
        variables: []
      })
    ).toThrow()
  })

  it('accepts an Assistant or Agent as the optional initial binding target', () => {
    expect(
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        visibility: 'restricted',
        bindingTarget: { type: 'assistant', id: TARGET_ID }
      })
    ).toMatchObject({ bindingTarget: { type: 'assistant', id: TARGET_ID } })
    expect(
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        visibility: 'restricted',
        bindingTarget: { type: 'agent', id: 'legacy-agent-id' }
      })
    ).toMatchObject({ bindingTarget: { type: 'agent', id: 'legacy-agent-id' } })
  })

  it('rejects an initial binding on a global prompt', () => {
    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        visibility: 'global',
        bindingTarget: { type: 'assistant', id: TARGET_ID }
      })
    ).toThrow()
  })

  it('rejects malformed or unsupported binding targets', () => {
    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        visibility: 'restricted',
        bindingTarget: { type: 'painting', id: TARGET_ID }
      })
    ).toThrow()
    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        visibility: 'restricted',
        bindingTarget: { type: 'assistant', id: 'not-a-uuid' }
      })
    ).toThrow()
  })

  it('rejects empty update payloads', () => {
    expect(() => UpdatePromptSchema.parse({})).toThrow('At least one field is required')
  })

  it('accepts partial title, content, or visibility updates', () => {
    expect(UpdatePromptSchema.parse({ title: 'renamed' })).toEqual({ title: 'renamed' })
    expect(UpdatePromptSchema.parse({ content: 'updated' })).toEqual({ content: 'updated' })
    expect(UpdatePromptSchema.parse({ visibility: 'restricted' })).toEqual({ visibility: 'restricted' })
  })

  it('accepts an exact binding snapshot only for a global visibility update', () => {
    const expectedBindings = [{ type: 'assistant' as const, id: TARGET_ID }]
    expect(UpdatePromptSchema.parse({ visibility: 'global', expectedBindings })).toEqual({
      visibility: 'global',
      expectedBindings
    })
    expect(() => UpdatePromptSchema.parse({ title: 'renamed', expectedBindings })).toThrow()
  })

  it('rejects update with empty title or content', () => {
    expect(() => UpdatePromptSchema.parse({ title: '' })).toThrow()
    expect(() => UpdatePromptSchema.parse({ content: '' })).toThrow()
  })

  it('rejects removed version, binding, and variable fields', () => {
    expect(() => UpdatePromptSchema.parse({ currentVersion: 2 })).toThrow()
    expect(() => UpdatePromptSchema.parse({ assistantId: 'assistant-1' })).toThrow()
    expect(() => UpdatePromptSchema.parse({ bindingTarget: { type: 'assistant', id: TARGET_ID } })).toThrow()
    expect(() => UpdatePromptSchema.parse({ variables: [] })).toThrow()
  })

  it('accepts and trims list search query', () => {
    expect(ListPromptsQuerySchema.parse({ search: ' daily ' })).toEqual({ search: 'daily' })
    expect(ListPromptsQuerySchema.parse({ visibility: 'global' })).toEqual({ visibility: 'global' })
  })

  it('rejects empty list search query and unknown query fields', () => {
    expect(() => ListPromptsQuerySchema.parse({ search: '   ' })).toThrow()
    expect(() => ListPromptsQuerySchema.parse({ tagIds: ['tag-1'] })).toThrow()
  })

  it('requires a complete Assistant or Agent target when filtering the list', () => {
    expect(ListPromptsQuerySchema.parse({ targetType: 'assistant', targetId: TARGET_ID, includeGlobal: true })).toEqual(
      {
        targetType: 'assistant',
        targetId: TARGET_ID,
        includeGlobal: true
      }
    )
    expect(() => ListPromptsQuerySchema.parse({ targetType: 'assistant', targetId: TARGET_ID })).toThrow()
    expect(() =>
      ListPromptsQuerySchema.parse({
        targetType: 'assistant',
        targetId: TARGET_ID,
        includeGlobal: true,
        visibility: 'global'
      })
    ).toThrow()
    expect(() => ListPromptsQuerySchema.parse({ targetType: 'assistant' })).toThrow()
    expect(() => ListPromptsQuerySchema.parse({ targetId: TARGET_ID })).toThrow()
    expect(() => ListPromptsQuerySchema.parse({ targetType: 'painting', targetId: TARGET_ID })).toThrow()
    expect(
      ListPromptsQuerySchema.parse({ targetType: 'agent', targetId: 'legacy-agent-id', includeGlobal: false })
    ).toEqual({
      targetType: 'agent',
      targetId: 'legacy-agent-id',
      includeGlobal: false
    })
  })

  it('validates binding route parameters', () => {
    expect(PromptBindingParamsSchema.parse({ id: PROMPT_ID, targetType: 'agent', targetId: TARGET_ID })).toEqual({
      id: PROMPT_ID,
      targetType: 'agent',
      targetId: TARGET_ID
    })
    expect(
      PromptBindingParamsSchema.parse({ id: PROMPT_ID, targetType: 'agent', targetId: 'legacy-agent-id' })
    ).toEqual({ id: PROMPT_ID, targetType: 'agent', targetId: 'legacy-agent-id' })
    expect(() =>
      PromptBindingParamsSchema.parse({ id: PROMPT_ID, targetType: 'assistant', targetId: 'invalid' })
    ).toThrow()
    expect(PromptBindingTargetParamsSchema.parse({ targetType: 'assistant', targetId: TARGET_ID })).toEqual({
      targetType: 'assistant',
      targetId: TARGET_ID
    })
  })
})
