import type { ImageGenerationSupport } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import {
  buildGenerateImageToolSchema,
  GENERATE_IMAGE_TOOL_NAME,
  generateImageInputSchema,
  KB_LIST_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbListInputSchema,
  kbListStrictInputSchema,
  kbManageInputSchema,
  kbManageStrictInputSchema,
  kbSearchInputSchema,
  REPORT_ARTIFACTS_DESCRIPTION,
  REPORT_ARTIFACTS_TOOL_NAME,
  reportArtifactsInputSchema,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webFetchInputSchema
} from '../builtinTools'

describe('builtin tool contracts', () => {
  it('uses model-facing builtin tool names', () => {
    expect(KB_LIST_TOOL_NAME).toBe('kb_list')
    expect(KB_SEARCH_TOOL_NAME).toBe('kb_search')
    expect(WEB_SEARCH_TOOL_NAME).toBe('web_search')
    expect(WEB_FETCH_TOOL_NAME).toBe('web_fetch')
    expect(REPORT_ARTIFACTS_TOOL_NAME).toBe('report_artifacts')
  })

  it('references the public knowledge list tool name from search input metadata', () => {
    const description = kbSearchInputSchema.shape.baseIds.description

    expect(description).toContain(KB_LIST_TOOL_NAME)
    expect(description).not.toContain('kb__list')
  })

  it('references the public web search tool name from fetch input metadata', () => {
    const description = webFetchInputSchema.shape.urls.description

    expect(description).toContain(WEB_SEARCH_TOOL_NAME)
    expect(description).not.toContain('web__search')
  })

  it('keeps kb_list strict-path fields in `required` so strict providers accept the schema', () => {
    // Regression: the AI-SDK path (KnowledgeListTool) runs strict:true. An all-optional object
    // serializes away `required` entirely, and a strict OpenAI-compatible provider then rejects the
    // whole request ("Tool ... has invalid 'parameters' schema: None is not of type 'array'"), killing
    // every tool call. The strict variant makes every field `.nullable()` (null = unused) so they all
    // stay in `required` with a null option — including the outline-mode `baseId` / `maxDepth`.
    const json = z.toJSONSchema(kbListStrictInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(expect.arrayContaining(['query', 'groupId', 'baseId', 'maxDepth']))
    // null is the "unused" signal for every field; an explicit all-null object must still parse.
    expect(
      kbListStrictInputSchema.safeParse({ query: null, groupId: null, baseId: null, maxDepth: null }).success
    ).toBe(true)
  })

  it('lets the MCP kb_list path omit either filter', () => {
    // The Claude Code bridge parses raw args with kbListInputSchema; an agent may omit filters
    // entirely, so the optional shape must accept `{}` and a lone query without erroring. (Making it
    // `.nullable()` to satisfy the strict path broke this — hence the separate strict variant.)
    expect(kbListInputSchema.safeParse({}).success).toBe(true)
    expect(kbListInputSchema.safeParse({ query: 'recipes' }).success).toBe(true)
  })

  it('keeps kb_manage strict-path fields in `required` so strict providers accept the schema', () => {
    // Same regression as kb_list above: the AI-SDK path (KnowledgeManageTool) runs strict:true, so
    // an all-optional object would serialize `required` away to nothing and a strict OpenAI-compatible
    // provider would reject the whole request. The strict variant makes every optional field
    // `.nullable()` (null = unused for this action/type) so they all stay in `required`.
    const json = z.toJSONSchema(kbManageStrictInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(
      expect.arrayContaining(['baseId', 'action', 'type', 'path', 'url', 'content', 'title', 'conceptIds'])
    )
    // null is the "unused" signal for every optional field; an explicit all-null payload must still parse.
    expect(
      kbManageStrictInputSchema.safeParse({
        baseId: 'kb-1',
        action: 'delete',
        type: null,
        path: null,
        url: null,
        content: null,
        title: null,
        conceptIds: null
      }).success
    ).toBe(true)
  })

  it('lets the MCP kb_manage path omit unused fields', () => {
    // The Claude Code bridge parses raw args with kbManageInputSchema; an agent may omit every
    // field but `baseId`/`action`, so the optional shape must accept that without erroring.
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'delete' }).success).toBe(true)
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'add', type: 'note', content: 'hi' }).success).toBe(
      true
    )
  })

  it('keeps the fallback generate_image schema object-only and prompt-required', () => {
    expect(GENERATE_IMAGE_TOOL_NAME).toBe('generate_image')
    const json = z.toJSONSchema(generateImageInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(['prompt'])
    expect(generateImageInputSchema.safeParse({ prompt: 'a cat' }).success).toBe(true)
  })

  it('keeps the fallback MCP generate_image schema prompt-only', () => {
    expect(generateImageInputSchema.safeParse({ prompt: 'a cat' }).success).toBe(true)
    expect(generateImageInputSchema.safeParse({ prompt: 'a cat', n: 2 }).success).toBe(false)
  })

  it('derives provider-accurate optional generate params', () => {
    const support = {
      modes: {
        generate: {
          supports: {
            size: { type: 'enum', options: ['1024x1024', '1792x1024'] },
            numImages: { type: 'range', min: 1, max: 3 }
          }
        }
      }
    } satisfies ImageGenerationSupport
    const inputSchema = buildGenerateImageToolSchema(support)
    const json = z.toJSONSchema(inputSchema) as { required?: string[]; properties?: Record<string, unknown> }

    expect(json.required).toEqual(['prompt'])
    expect(json.properties).not.toHaveProperty('image_ids')
    expect(inputSchema.safeParse({ prompt: 'a cat', size: '1792x1024', numImages: 2 }).success).toBe(true)
    expect(inputSchema.safeParse({ prompt: 'a cat', size: '2048x2048' }).success).toBe(false)
  })

  it('adds image_ids only for edit-capable models and applies the configured cap', () => {
    const support = {
      modes: {
        generate: { supports: { size: { type: 'enum', options: ['1024x1024'] } } },
        edit: {
          supports: {
            maxImages: { type: 'range', min: 1, max: 2 },
            quality: { type: 'enum', options: ['low', 'high'] }
          }
        }
      }
    } satisfies ImageGenerationSupport
    const inputSchema = buildGenerateImageToolSchema(support)
    const json = z.toJSONSchema(inputSchema) as { required?: string[] }

    expect(inputSchema.safeParse({ prompt: 'edit', image_ids: ['f1', 'f2'], quality: 'high' }).success).toBe(true)
    expect(inputSchema.safeParse({ prompt: 'edit', image_ids: ['f1', 'f2', 'f3'] }).success).toBe(false)
    expect(json.required).toEqual(['prompt'])
  })

  it('validates final report artifacts', () => {
    const result = reportArtifactsInputSchema.parse({
      artifacts: [{ path: 'dist/report.pdf', description: 'Final report' }],
      summary: 'Generated report'
    })

    expect(result.artifacts[0]).toEqual({ path: 'dist/report.pdf', description: 'Final report' })
    expect(reportArtifactsInputSchema.safeParse({ artifacts: [] }).success).toBe(false)
    expect(reportArtifactsInputSchema.safeParse({ artifacts: [{ path: '   ' }] }).success).toBe(false)
    expect(REPORT_ARTIFACTS_DESCRIPTION).toContain('final deliverable')
  })
})
