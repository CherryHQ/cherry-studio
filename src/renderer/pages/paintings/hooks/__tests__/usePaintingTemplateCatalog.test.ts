import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const paintingTemplateCatalogMocks = vi.hoisted(() => ({
  language: 'zh-CN',
  read: vi.fn(),
  resourcesPath: '/resources'
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => [paintingTemplateCatalogMocks.resourcesPath]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: paintingTemplateCatalogMocks.language,
      resolvedLanguage: paintingTemplateCatalogMocks.language
    }
  })
}))

import { usePaintingTemplateCatalog } from '../usePaintingTemplateCatalog'

describe('painting template catalog', () => {
  beforeEach(() => {
    paintingTemplateCatalogMocks.language = 'zh-CN'
    paintingTemplateCatalogMocks.read.mockReset()
    paintingTemplateCatalogMocks.read.mockImplementation((path: string) => {
      if (path.endsWith('catalog.json')) {
        return Promise.resolve(JSON.stringify([{ id: 'birthday-poster', preview: 'images/birthday-poster.webp' }]))
      }

      return Promise.resolve(
        JSON.stringify({
          'birthday-poster': {
            label: '生日海报',
            prompt: '儿童姓名：${儿童姓名}。庆祝年龄：${年龄}。'
          }
        })
      )
    })
    Object.assign(window, {
      api: {
        ...window.api,
        fs: {
          ...window.api.fs,
          read: paintingTemplateCatalogMocks.read
        }
      }
    })
  })

  it('loads localized prompts and preview URLs from bundled resources', async () => {
    const { result } = renderHook(() => usePaintingTemplateCatalog())

    await waitFor(() => expect(result.current.templates).toHaveLength(1))
    expect(paintingTemplateCatalogMocks.read).toHaveBeenCalledWith(
      '/resources/data/painting-templates/catalog.json',
      'utf-8'
    )
    expect(paintingTemplateCatalogMocks.read).toHaveBeenCalledWith(
      '/resources/data/painting-templates/locales/zh-cn.json',
      'utf-8'
    )
    expect(result.current.templates[0]).toEqual({
      id: 'birthday-poster',
      imageUrl: 'file:///resources/data/painting-templates/images/birthday-poster.webp',
      label: '生日海报',
      prompt: '儿童姓名：${儿童姓名}。庆祝年龄：${年龄}。'
    })
  })

  it('falls back to English when a bundled locale is unavailable', async () => {
    paintingTemplateCatalogMocks.language = 'zh-TW'

    const { result } = renderHook(() => usePaintingTemplateCatalog())

    await waitFor(() => expect(result.current.templates).toHaveLength(1))
    expect(paintingTemplateCatalogMocks.read).toHaveBeenCalledWith(
      '/resources/data/painting-templates/locales/en-us.json',
      'utf-8'
    )
  })
})
