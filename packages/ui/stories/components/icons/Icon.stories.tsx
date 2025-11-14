import type { Meta, StoryObj } from '@storybook/react'
import { ChevronRight, Download, Settings, Upload } from 'lucide-react'

import {
  CopyIcon,
  createIcon,
  DeleteIcon,
  EditIcon,
  OcrIcon,
  RefreshIcon,
  ResetIcon,
  ToolIcon,
  UnWrapIcon,
  VisionIcon,
  WebSearchIcon,
  WrapIcon
} from '../../../src/components/icons/Icon'

// Create a dummy component for the story
const IconShowcase = () => <div />

const meta: Meta<typeof IconShowcase> = {
  title: 'Components/Icons/Icon',
  component: IconShowcase,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      description: '图标大小 (支持数字或字符串)',
      control: { type: 'text' },
      defaultValue: '1rem'
    },
    color: {
      description: '图标颜色',
      control: { type: 'color' }
    },
    className: {
      description: '自定义 CSS 类名',
      control: { type: 'text' }
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Predefined Icons
export const PredefinedIcons: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">预定义图标 (默认尺寸: 1rem)</h3>
        <div className="grid grid-cols-6 gap-4">
          <div className="flex flex-col items-center gap-2">
            <CopyIcon />
            <span className="text-xs text-gray-600">CopyIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <DeleteIcon />
            <span className="text-xs text-gray-600">DeleteIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <EditIcon />
            <span className="text-xs text-gray-600">EditIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <RefreshIcon />
            <span className="text-xs text-gray-600">RefreshIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ResetIcon />
            <span className="text-xs text-gray-600">ResetIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ToolIcon />
            <span className="text-xs text-gray-600">ToolIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <VisionIcon />
            <span className="text-xs text-gray-600">VisionIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <WebSearchIcon />
            <span className="text-xs text-gray-600">WebSearchIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <WrapIcon />
            <span className="text-xs text-gray-600">WrapIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <UnWrapIcon />
            <span className="text-xs text-gray-600">UnWrapIcon</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <OcrIcon />
            <span className="text-xs text-gray-600">OcrIcon</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Different Sizes
export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <CopyIcon size={12} />
        <CopyIcon size={16} />
        <CopyIcon size={20} />
        <CopyIcon size={24} />
        <CopyIcon size={32} />
        <CopyIcon size={48} />
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>12px</span>
        <span className="ml-2">16px</span>
        <span className="ml-4">20px</span>
        <span className="ml-4">24px</span>
        <span className="ml-6">32px</span>
        <span className="ml-10">48px</span>
      </div>
    </div>
  )
}

// Custom Colors
export const CustomColors: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <EditIcon color="#3B82F6" size={24} />
      <EditIcon color="#10B981" size={24} />
      <EditIcon color="#F59E0B" size={24} />
      <EditIcon color="#EF4444" size={24} />
      <EditIcon color="#8B5CF6" size={24} />
      <EditIcon color="#EC4899" size={24} />
    </div>
  )
}

// Custom Icon Creation
export const CustomIconCreation: Story = {
  render: () => {
    // Create custom icons using the factory
    const SettingsIcon = createIcon(Settings, 24)
    const DownloadIcon = createIcon(Download, 20)
    const UploadIcon = createIcon(Upload, 20)
    const ChevronIcon = createIcon(ChevronRight, 16)

    return (
      <div className="space-y-6">
        <div>
          <h3 className="mb-3 font-semibold">使用工厂函数创建的自定义图标</h3>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <SettingsIcon />
              <span className="text-xs text-gray-600">Settings (24px)</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <DownloadIcon />
              <span className="text-xs text-gray-600">Download (20px)</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <UploadIcon />
              <span className="text-xs text-gray-600">Upload (20px)</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <ChevronIcon />
              <span className="text-xs text-gray-600">Chevron (16px)</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-semibold">覆盖默认尺寸</h3>
          <div className="flex items-center gap-4">
            <SettingsIcon size={32} />
            <DownloadIcon size={32} />
            <UploadIcon size={32} />
            <ChevronIcon size={32} />
          </div>
        </div>
      </div>
    )
  }
}

// Icon States
export const IconStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button type="button" className="rounded p-2 hover:bg-gray-100">
          <EditIcon size={20} />
        </button>
        <button type="button" className="rounded p-2 hover:bg-gray-100" disabled>
          <EditIcon size={20} className="opacity-50" />
        </button>
        <button type="button" className="rounded bg-blue-500 p-2 text-white hover:bg-blue-600">
          <EditIcon size={20} />
        </button>
      </div>
      <div className="flex gap-4 text-xs text-gray-600">
        <span>Normal</span>
        <span>Disabled</span>
        <span>Active</span>
      </div>
    </div>
  )
}

// In Context
export const InContext: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Document.pdf</h3>
          <div className="flex gap-2">
            <button type="button" className="rounded p-1 hover:bg-gray-100">
              <CopyIcon size={16} />
            </button>
            <button type="button" className="rounded p-1 hover:bg-gray-100">
              <EditIcon size={16} />
            </button>
            <button type="button" className="rounded p-1 hover:bg-gray-100">
              <DeleteIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="mb-3 flex items-center gap-2">
          <VisionIcon size={20} />
          <span className="font-medium">Image Processing</span>
        </div>
        <p className="mb-3 text-sm text-gray-600">Process your images with advanced AI tools</p>
        <button
          type="button"
          className="flex items-center gap-2 rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600">
          <OcrIcon size={16} />
          <span>Extract Text</span>
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">Auto-refresh</span>
          <RefreshIcon size={18} className="animate-spin text-blue-500" />
        </div>
      </div>
    </div>
  )
}

// Icon Grid
export const IconGrid: Story = {
  render: () => {
    const AllIcons = [
      { Icon: CopyIcon, name: 'Copy' },
      { Icon: DeleteIcon, name: 'Delete' },
      { Icon: EditIcon, name: 'Edit' },
      { Icon: RefreshIcon, name: 'Refresh' },
      { Icon: ResetIcon, name: 'Reset' },
      { Icon: ToolIcon, name: 'Tool' },
      { Icon: VisionIcon, name: 'Vision' },
      { Icon: WebSearchIcon, name: 'Search' },
      { Icon: WrapIcon, name: 'Wrap' },
      { Icon: UnWrapIcon, name: 'Unwrap' },
      { Icon: OcrIcon, name: 'OCR' }
    ]

    return (
      <div className="grid grid-cols-6 gap-4">
        {AllIcons.map(({ Icon, name }) => (
          <div
            key={name}
            className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:border-blue-500">
            <Icon size={24} />
            <span className="text-xs">{name}</span>
          </div>
        ))}
      </div>
    )
  }
}
