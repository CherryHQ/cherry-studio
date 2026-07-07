import materialIconThemeIcons from '@iconify-json/material-icon-theme/icons.json'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FILE_ICON_NAMES } from '../fileIconName'
import { createMaterialFileIconCollection, registerIconifyCollections } from '../iconifyCollections'

const addCollectionMock = vi.hoisted(() => vi.fn())

vi.mock('@iconify/react', () => ({
  addCollection: addCollectionMock
}))

describe('iconifyCollections', () => {
  beforeEach(() => {
    addCollectionMock.mockClear()
  })

  it('creates a local material icon collection for every mapped file icon without bundling the full pack', () => {
    const collection = createMaterialFileIconCollection()

    expect(collection.prefix).toBe('material-icon-theme')
    expect(collection.width).toBe(materialIconThemeIcons.width)
    expect(collection.height).toBe(materialIconThemeIcons.height)
    expect(Object.keys(collection.icons).length).toBeLessThan(Object.keys(materialIconThemeIcons.icons).length)

    for (const iconName of FILE_ICON_NAMES) {
      expect(collection.icons[iconName]).toBeDefined()
    }

    expect(collection.icons['folder-other']).toBeDefined()
    expect(collection.icons['folder-other-open']).toBeDefined()
  })

  it('registers the local file icon collection once', () => {
    const collection = createMaterialFileIconCollection()

    registerIconifyCollections()
    registerIconifyCollections()

    expect(addCollectionMock).toHaveBeenCalledTimes(1)
    expect(addCollectionMock).toHaveBeenCalledWith(collection)
  })
})
