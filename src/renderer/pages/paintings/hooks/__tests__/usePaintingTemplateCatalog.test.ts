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
        return Promise.resolve(JSON.stringify(['birthday-poster', '../invalid-template']))
      }

      return Promise.resolve(
        JSON.stringify({
          'birthday-poster': {
            label: '生日海报',
            prompt: '儿童姓名：${MUNONYE}。庆祝年龄：${2}。'
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
      prompt: '儿童姓名：${MUNONYE}。庆祝年龄：${2}。'
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

  it('randomizes templates once when the catalog loads and keeps the order stable across rerenders', async () => {
    paintingTemplateCatalogMocks.read.mockImplementation((path: string) => {
      if (path.endsWith('catalog.json')) {
        return Promise.resolve(JSON.stringify(['first-template', 'second-template', 'third-template']))
      }

      return Promise.resolve(
        JSON.stringify({
          'first-template': { label: 'First', prompt: 'First prompt' },
          'second-template': { label: 'Second', prompt: 'Second prompt' },
          'third-template': { label: 'Third', prompt: 'Third prompt' }
        })
      )
    })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)

    const { result, rerender } = renderHook(() => usePaintingTemplateCatalog())

    await waitFor(() => expect(result.current.templates).toHaveLength(3))
    expect(result.current.templates.map(({ id }) => id)).toEqual([
      'second-template',
      'third-template',
      'first-template'
    ])

    rerender()

    expect(result.current.templates.map(({ id }) => id)).toEqual([
      'second-template',
      'third-template',
      'first-template'
    ])
    expect(random).toHaveBeenCalledTimes(2)
    random.mockRestore()
  })
})
