import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { expect, it, vi } from 'vitest'

import { CodeBlockView } from '../CodeBlockView'

const state = vi.hoisted(() => ({ ready: false, toggle: () => {}, mounts: 0 }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({}) } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@cherrystudio/ui', () => ({}))
vi.mock('@cherrystudio/ui/code-block', () => ({ codeBlockHighlightStyle: {} }))
vi.mock('../../../data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key === 'chat.message.font_size' ? 14 : false],
  useMultiplePreferences: () => [{ enabled: false }]
}))
vi.mock('../../../hooks/useCodeStyle', () => ({ useCodeStyle: () => ({}) }))
vi.mock('../../../services/PyodideService', () => ({ pyodideService: {} }))
vi.mock('../../../services/toast', () => ({ toast: {} }))
vi.mock('../../../utils/codeLanguage', () => ({ getExtensionByLanguage: () => '.txt' }))
vi.mock('../../../utils/formats', () => ({ extractHtmlTitle: () => '', getFileNameFromHtmlTitle: () => '' }))
vi.mock('../../../utils/style', () => ({ cn: () => '' }))
vi.mock('../../icons/FileIcon', () => ({ FileIcon: () => null }))
vi.mock('../../ImageViewer', () => ({ default: () => null }))
vi.mock('../../LazyCodeEditor', () => ({ LazyCodeEditor: () => null }))
vi.mock('../../CodeViewer', () => ({ default: () => <pre>source</pre> }))
vi.mock('../wrapLinesContext', () => ({ useCodeBlockWrapLines: () => false }))
vi.mock('../StatusBar', () => ({ default: () => null }))
vi.mock('../../CodeToolbar', () => ({
  CodeToolbar: () => <button onClick={() => state.toggle()}>split:{String(state.ready)}</button>,
  useCopyTool: ({ previewImageReady }: { previewImageReady: boolean }) => {
    state.ready = previewImageReady
  },
  useSplitViewTool: ({ onToggleSplitView }: { onToggleSplitView: () => void }) => {
    state.toggle = onToggleSplitView
  },
  useDownloadTool: () => {},
  useExpandTool: () => {},
  useRunTool: () => {},
  useSaveTool: () => {},
  useViewSourceTool: () => {},
  useWrapTool: () => {}
}))
vi.mock('../constants', () => ({
  MAX_COLLAPSED_CODE_HEIGHT: 300,
  SPECIAL_VIEWS: ['plantuml'],
  SPECIAL_VIEW_COMPONENTS: {
    plantuml: {
      supportsImageActions: true,
      component: function Preview({ onImageReadyChange }: { onImageReadyChange: (ready: boolean) => void }) {
        useEffect(() => {
          state.mounts++
          onImageReadyChange(true)
        }, [onImageReadyChange])
        return <div>preview</div>
      }
    }
  }
}))

it('keeps the production readiness key stable when the mounted preview switches to Split View and back', () => {
  state.mounts = 0
  render(
    <CodeBlockView language="plantuml" editable={false}>
      {'@startuml\nAlice -> Bob\n@enduml'}
    </CodeBlockView>
  )
  expect(state.ready).toBe(true)
  expect(state.mounts).toBe(1)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText('source')).toBeInTheDocument()
  expect(state.ready).toBe(true)
  expect(state.mounts).toBe(1)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.queryByText('source')).not.toBeInTheDocument()
  expect(state.ready).toBe(true)
  expect(state.mounts).toBe(1)
})
