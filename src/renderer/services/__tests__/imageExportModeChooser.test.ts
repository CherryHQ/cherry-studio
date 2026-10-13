import { describe, expect, it, vi } from 'vitest'

import { chooseImageExportMode, registerImageModeChooser } from '../imageExportModeChooser'

describe('imageExportModeChooser registry', () => {
  it('aborts with undefined until registered, then delegates to the implementation', async () => {
    await expect(chooseImageExportMode(1)).resolves.toBeUndefined()

    const chooser = vi.fn().mockResolvedValue('folder')
    registerImageModeChooser(chooser)

    await expect(chooseImageExportMode(3)).resolves.toBe('folder')
    expect(chooser).toHaveBeenCalledWith(3)
  })
})
