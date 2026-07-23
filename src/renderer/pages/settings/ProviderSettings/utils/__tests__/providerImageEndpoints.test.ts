import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  findInvalidProviderImageEndpointDraft,
  mergeProviderImageEndpointDraft,
  readProviderImageEndpointDraft
} from '../providerImageEndpoints'

describe('provider image endpoint drafts', () => {
  it('uses one image URL for generation and editing by default', () => {
    expect(
      mergeProviderImageEndpointDraft(undefined, {
        imagesBaseUrl: ' https://images.example.com ',
        useSeparateImageEditUrl: false,
        imageEditBaseUrl: ''
      })
    ).toEqual({
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://images.example.com' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://images.example.com' }
    })
  })

  it('allows image editing to use an independent URL', () => {
    expect(
      mergeProviderImageEndpointDraft(undefined, {
        imagesBaseUrl: 'https://generate.example.com',
        useSeparateImageEditUrl: true,
        imageEditBaseUrl: 'https://edit.example.com'
      })
    ).toEqual({
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://generate.example.com' },
      [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://edit.example.com' }
    })
  })

  it('leaves image endpoints unset so generation and editing fall back to the provider Base URL', () => {
    const existing = {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' }
    }

    expect(
      mergeProviderImageEndpointDraft(existing, {
        imagesBaseUrl: '',
        useSeparateImageEditUrl: false,
        imageEditBaseUrl: ''
      })
    ).toEqual(existing)
  })

  it('preserves an existing generation-only topology when read and merged without changes', () => {
    const existing = {
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: {
        baseUrl: 'https://generate.example.com',
        adapterFamily: 'openai-compatible'
      }
    }
    const draft = readProviderImageEndpointDraft(existing)

    expect(draft).toEqual({
      imagesBaseUrl: 'https://generate.example.com',
      useSeparateImageEditUrl: true,
      imageEditBaseUrl: ''
    })
    expect(mergeProviderImageEndpointDraft(existing, draft)).toEqual(existing)
  })

  it('reports only non-empty invalid URLs', () => {
    expect(
      findInvalidProviderImageEndpointDraft({
        imagesBaseUrl: 'not-a-url',
        useSeparateImageEditUrl: false,
        imageEditBaseUrl: ''
      })
    ).toBe('imagesBaseUrl')
    expect(
      findInvalidProviderImageEndpointDraft({
        imagesBaseUrl: '',
        useSeparateImageEditUrl: true,
        imageEditBaseUrl: 'ftp://edit.example.com'
      })
    ).toBe('imageEditBaseUrl')
  })
})
