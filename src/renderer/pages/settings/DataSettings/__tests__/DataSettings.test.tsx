import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingsContentColumn: ({ children }: { children: React.ReactNode }) => <main>{children}</main>
}))
vi.mock('@renderer/pages/settings/settingsStyles', () => ({
  settingsSubmenuDividerClassName: '',
  settingsSubmenuItemClassName: '',
  settingsSubmenuItemLabelClassName: '',
  settingsSubmenuListClassName: '',
  settingsSubmenuScrollClassName: '',
  settingsSubmenuSectionTitleClassName: ''
}))
vi.mock('@cherrystudio/ui', () => ({
  MenuDivider: () => <hr />,
  MenuItem: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  MenuList: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  RowFlex: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('../BasicDataSettings', () => ({ default: () => <div>BasicDataSettings</div> }))
vi.mock('../ExportMenuSettings', () => ({ default: () => <div /> }))
vi.mock('../ImportMenuSettings', () => ({ default: () => <div /> }))
vi.mock('../JoplinSettings', () => ({ default: () => <div /> }))
vi.mock('../MarkdownExportSettings', () => ({ default: () => <div /> }))
vi.mock('../NotionSettings', () => ({ default: () => <div /> }))
vi.mock('../ObsidianSettings', () => ({ default: () => <div /> }))
vi.mock('../SiyuanSettings', () => ({ default: () => <div /> }))
vi.mock('../YuqueSettings', () => ({ default: () => <div /> }))

import DataSettings from '../DataSettings'

describe('DataSettings', () => {
  it('does not mount legacy Local, WebDAV, Nutstore, or S3 backup controls', () => {
    render(<DataSettings />)

    expect(screen.queryByRole('button', { name: 'settings.data.local.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.data.webdav.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.data.nutstore.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.data.s3.title.label' })).not.toBeInTheDocument()
    expect(screen.getByText('BasicDataSettings')).toBeInTheDocument()
  })
})
