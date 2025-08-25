import { NotesSettings } from '@renderer/store/note'
import { Copy, MonitorSpeaker, Type } from 'lucide-react'
import { ReactNode } from 'react'

export interface MenuItem {
  key: string
  type?: 'divider' | 'component'
  labelKey: string
  icon?: React.ComponentType<any>
  action?: (settings: NotesSettings, updateSettings: (newSettings: Partial<NotesSettings>) => void) => void
  children?: MenuItem[]
  isActive?: (settings: NotesSettings) => boolean
  component?: (settings: NotesSettings, updateSettings: (newSettings: Partial<NotesSettings>) => void) => ReactNode
  copyAction?: boolean
}

export const menuItems: MenuItem[] = [
  {
    key: 'copy-content',
    labelKey: 'notes.copyContent',
    icon: Copy,
    copyAction: true
  },
  {
    key: 'divider0',
    type: 'divider',
    labelKey: ''
  },
  {
    key: 'fullwidth',
    labelKey: 'notes.settings.display.compress_content',
    icon: MonitorSpeaker,
    action: (settings, updateSettings) => updateSettings({ isFullWidth: !settings.isFullWidth }),
    isActive: (settings) => !settings.isFullWidth
  },
  {
    key: 'divider1',
    type: 'divider',
    labelKey: ''
  },
  {
    key: 'font',
    labelKey: 'notes.settings.display.font_title',
    icon: Type,
    children: [
      {
        key: 'default-font',
        labelKey: 'notes.settings.display.default_font',
        action: (_, updateSettings) => updateSettings({ fontFamily: 'default' }),
        isActive: (settings) => settings.fontFamily === 'default'
      },
      {
        key: 'serif-font',
        labelKey: 'notes.settings.display.serif_font',
        action: (_, updateSettings) => updateSettings({ fontFamily: 'serif' }),
        isActive: (settings) => settings.fontFamily === 'serif'
      }
    ]
  }
]
