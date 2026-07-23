import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  findInvalidProviderImageEndpointDraft,
  mergeProviderImageEndpointDraft,
  readProviderImageEndpointDraft
} from '../providerImageEndpoints'

describe('provider image endpoint drafts', () => {
  it('stores generation and editing URLs independently', () => {
    expect(
      mergeProviderImageEndpointDraft(undefined, {
        imageGenerationBaseUrl: ' https://generate.example.com ',
        imageEditBaseUrl: ' https://edit.example.com '
      })
    ).toEqual({
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://generate.example.com' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://edit.example.com' }
    })
  })

  it('leaves blank image endpoints unset so requests can fall back to the provider Base URL', () => {
    const existing = {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' }
    }

    expect(
      mergeProviderImageEndpointDraft(existing, {
        imageGenerationBaseUrl: '',
        imageEditBaseUrl: ''
      })
    ).toEqual(existing)
  })

  it('preserves endpoint metadata when a Base URL is read and merged without changes', () => {
    const existing = {
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: {
        baseUrl: 'https://generate.example.com',
        adapterFamily: 'openai-compatible'
      }
    }
    const draft = readProviderImageEndpointDraft(existing)

    expect(draft).toEqual({
      imageGenerationBaseUrl: 'https://generate.example.com',
      imageEditBaseUrl: ''
    })
    expect(mergeProviderImageEndpointDraft(existing, draft)).toEqual(existing)
  })

  it('clears only the edited image endpoint while preserving the other endpoint', () => {
    const existing = {
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://generate.example.com' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://edit.example.com' }
    }

    expect(
      mergeProviderImageEndpointDraft(existing, {
        imageGenerationBaseUrl: '',
        imageEditBaseUrl: 'https://edit.example.com'
      })
    ).toEqual({
      [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://edit.example.com' }
    })
  })

  it('reports only non-empty invalid URLs', () => {
    expect(
      findInvalidProviderImageEndpointDraft({
        imageGenerationBaseUrl: 'not-a-url',
        imageEditBaseUrl: ''
      })
    ).toBe('imageGenerationBaseUrl')
    expect(
      findInvalidProviderImageEndpointDraft({
        imageGenerationBaseUrl: '',
        imageEditBaseUrl: 'ftp://edit.example.com'
      })
    ).toBe('imageEditBaseUrl')
  })
})
