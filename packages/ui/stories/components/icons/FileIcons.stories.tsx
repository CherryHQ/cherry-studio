import type { Meta, StoryObj } from '@storybook/react'

import { FilePngIcon, FileSvgIcon } from '../../../src/components/icons/FileIcons'

// Create a dummy component for the story
const FileIconsShowcase = () => <div />

const meta: Meta<typeof FileIconsShowcase> = {
  title: 'Components/Icons/FileIcons',
  component: FileIconsShowcase,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      description: '图标大小',
      control: { type: 'text' },
      defaultValue: '1.1em'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Basic File Icons
export const BasicFileIcons: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">文件类型图标 (默认尺寸: 1.1em)</h3>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon />
            <span className="text-xs text-gray-600">SVG 文件</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon />
            <span className="text-xs text-gray-600">PNG 文件</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Different Sizes
export const DifferentSizes: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">不同尺寸的 SVG 图标</h3>
        <div className="flex items-end gap-4">
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="16" />
            <span className="text-xs text-gray-600">16px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="24" />
            <span className="text-xs text-gray-600">24px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="32" />
            <span className="text-xs text-gray-600">32px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="48" />
            <span className="text-xs text-gray-600">48px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="64" />
            <span className="text-xs text-gray-600">64px</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-semibold">不同尺寸的 PNG 图标</h3>
        <div className="flex items-end gap-4">
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="16" />
            <span className="text-xs text-gray-600">16px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="24" />
            <span className="text-xs text-gray-600">24px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="32" />
            <span className="text-xs text-gray-600">32px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="48" />
            <span className="text-xs text-gray-600">48px</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="64" />
            <span className="text-xs text-gray-600">64px</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Custom Colors
export const CustomColors: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-semibold">自定义颜色 - SVG 图标</h3>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="32" color="#3B82F6" />
            <span className="text-xs text-gray-600">蓝色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="32" color="#10B981" />
            <span className="text-xs text-gray-600">绿色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="32" color="#F59E0B" />
            <span className="text-xs text-gray-600">橙色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="32" color="#EF4444" />
            <span className="text-xs text-gray-600">红色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FileSvgIcon size="32" color="#8B5CF6" />
            <span className="text-xs text-gray-600">紫色</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-semibold">自定义颜色 - PNG 图标</h3>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="32" color="#3B82F6" />
            <span className="text-xs text-gray-600">蓝色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="32" color="#10B981" />
            <span className="text-xs text-gray-600">绿色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="32" color="#F59E0B" />
            <span className="text-xs text-gray-600">橙色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="32" color="#EF4444" />
            <span className="text-xs text-gray-600">红色</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilePngIcon size="32" color="#8B5CF6" />
            <span className="text-xs text-gray-600">紫色</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// In File List Context
export const InFileListContext: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">文件列表中的使用示例</h3>

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded p-2 hover:bg-gray-50">
            <FileSvgIcon size="20" />
            <span className="flex-1">illustration.svg</span>
            <span className="text-xs text-gray-500">45 KB</span>
          </div>

          <div className="flex items-center gap-3 rounded p-2 hover:bg-gray-50">
            <FilePngIcon size="20" />
            <span className="flex-1">screenshot.png</span>
            <span className="text-xs text-gray-500">1.2 MB</span>
          </div>

          <div className="flex items-center gap-3 rounded p-2 hover:bg-gray-50">
            <FileSvgIcon size="20" />
            <span className="flex-1">logo.svg</span>
            <span className="text-xs text-gray-500">12 KB</span>
          </div>

          <div className="flex items-center gap-3 rounded p-2 hover:bg-gray-50">
            <FilePngIcon size="20" />
            <span className="flex-1">background.png</span>
            <span className="text-xs text-gray-500">2.8 MB</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// File Type Grid
export const FileTypeGrid: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="mb-3 font-semibold">文件类型网格展示</h3>

      <div className="grid grid-cols-4 gap-4">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:border-blue-500">
          <FileSvgIcon size="48" />
          <span className="text-sm font-medium">SVG</span>
          <span className="text-xs text-gray-600">矢量图形</span>
        </div>

        <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:border-blue-500">
          <FilePngIcon size="48" />
          <span className="text-sm font-medium">PNG</span>
          <span className="text-xs text-gray-600">位图图像</span>
        </div>

        <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:border-blue-500">
          <FileSvgIcon size="48" color="#10B981" />
          <span className="text-sm font-medium">SVG</span>
          <span className="text-xs text-gray-600">已处理</span>
        </div>

        <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:border-blue-500">
          <FilePngIcon size="48" color="#EF4444" />
          <span className="text-sm font-medium">PNG</span>
          <span className="text-xs text-gray-600">错误状态</span>
        </div>
      </div>
    </div>
  )
}

// Interactive Example
export const InteractiveExample: Story = {
  render: () => {
    const fileTypes = [
      { icon: FileSvgIcon, name: 'Vector Graphics', ext: 'SVG', color: '#3B82F6' },
      { icon: FilePngIcon, name: 'Raster Image', ext: 'PNG', color: '#10B981' }
    ]

    return (
      <div className="space-y-4">
        <h3 className="mb-3 font-semibold">交互式文件类型选择器</h3>

        <div className="grid grid-cols-2 gap-4">
          {fileTypes.map((fileType, index) => {
            const IconComponent = fileType.icon
            return (
              <button
                key={index}
                type="button"
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-all hover:border-blue-500 hover:shadow-md focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                <IconComponent size="32" color={fileType.color} />
                <div>
                  <div className="font-medium">{fileType.ext} 文件</div>
                  <div className="text-sm text-gray-600">{fileType.name}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }
}
