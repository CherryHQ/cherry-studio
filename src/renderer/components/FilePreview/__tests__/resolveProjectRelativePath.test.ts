import { describe, expect, it } from 'vitest'

import { resolveProjectRelativePath } from '../ElectronFilePreview'

describe('resolveProjectRelativePath', () => {
  it('resolves pages and media against the manifest directory', () => {
    expect(resolveProjectRelativePath('/deck/presentation.pptd', 'pages/1_cover.page')).toBe('/deck/pages/1_cover.page')
    expect(resolveProjectRelativePath('/deck/presentation.pptd', 'media/image1.jpg')).toBe('/deck/media/image1.jpg')
    expect(resolveProjectRelativePath('/deck/sub/presentation.pptd', './pages/a.page')).toBe('/deck/sub/pages/a.page')
  })

  it('rejects paths escaping the project directory', () => {
    expect(resolveProjectRelativePath('/deck/presentation.pptd', '../outside.page')).toBeNull()
    expect(resolveProjectRelativePath('/deck/presentation.pptd', 'pages/../../secret')).toBeNull()
    expect(resolveProjectRelativePath('/deck/presentation.pptd', '/etc/passwd')).toBeNull()
    expect(resolveProjectRelativePath('/deck/presentation.pptd', '')).toBeNull()
  })

  it('rejects windows absolute paths and keeps windows separators', () => {
    expect(resolveProjectRelativePath('C:\\deck\\presentation.pptd', 'C:\\other\\file.page')).toBeNull()
    expect(resolveProjectRelativePath('C:\\deck\\presentation.pptd', 'pages\\a.page')).toBe('C:\\deck\\pages\\a.page')
  })
})
