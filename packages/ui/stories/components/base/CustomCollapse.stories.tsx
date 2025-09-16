import { Button } from '@heroui/react'
import type { Meta, StoryObj } from '@storybook/react'
import { AlertTriangle, Info, Settings } from 'lucide-react'
import { useState } from 'react'

import CustomCollapse from '../../../src/components/base/CustomCollapse'

const meta: Meta<typeof CustomCollapse> = {
  title: 'Base/CustomCollapse',
  component: CustomCollapse,
  parameters: {
    layout: 'padded'
  },
  tags: ['autodocs'],
  argTypes: {
    label: {
      control: false,
      description: '折叠面板的标题内容'
    },
    extra: {
      control: false,
      description: '标题栏右侧的额外内容'
    },
    children: {
      control: false,
      description: '折叠面板的内容'
    },
    destroyInactivePanel: {
      control: 'boolean',
      description: '是否销毁非活动面板的内容'
    },
    defaultActiveKey: {
      control: false,
      description: '默认激活的面板键值'
    },
    activeKey: {
      control: false,
      description: '当前激活的面板键值（受控模式）'
    },
    collapsible: {
      control: 'select',
      options: ['header', 'icon', 'disabled', undefined],
      description: '折叠触发方式'
    },
    onChange: {
      control: false,
      description: '面板状态变化回调'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    label: '默认折叠面板',
    children: (
      <div className="p-4">
        <p>这是折叠面板的内容。</p>
        <p>可以包含任何内容，包括文本、图片、表单等。</p>
      </div>
    )
  }
}

export const WithExtra: Story = {
  args: {
    label: '带额外内容的面板',
    extra: (
      <Button size="sm" variant="ghost">
        编辑
      </Button>
    ),
    children: (
      <div className="p-4">
        <p>这个面板在标题栏右侧有一个额外的按钮。</p>
        <p>额外内容不会触发折叠/展开操作。</p>
      </div>
    )
  }
}

export const WithIcon: Story = {
  args: {
    label: (
      <div className="flex items-center gap-2">
        <Settings size={16} />
        <span>设置面板</span>
      </div>
    ),
    children: (
      <div className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span>通知设置</span>
            <Button size="sm" variant="flat">
              开启
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <span>自动更新</span>
            <Button size="sm" variant="flat">
              关闭
            </Button>
          </div>
        </div>
      </div>
    )
  }
}

export const CollapsibleHeader: Story = {
  args: {
    label: '点击整个标题栏展开/收起',
    collapsible: 'header',
    children: (
      <div className="p-4">
        <p>通过设置 collapsible="header"，点击整个标题栏都可以触发折叠/展开。</p>
      </div>
    )
  }
}

export const CollapsibleIcon: Story = {
  args: {
    label: '仅点击图标展开/收起',
    collapsible: 'icon',
    children: (
      <div className="p-4">
        <p>通过设置 collapsible="icon"，只有点击左侧的箭头图标才能触发折叠/展开。</p>
      </div>
    )
  }
}

export const Disabled: Story = {
  args: {
    label: '禁用的折叠面板',
    collapsible: 'disabled',
    children: (
      <div className="p-4">
        <p>这个面板被禁用了，无法折叠或展开。</p>
      </div>
    )
  }
}

export const DestroyInactivePanel: Story = {
  args: {
    label: '销毁非活动内容',
    destroyInactivePanel: true,
    children: (
      <div className="p-4">
        <p>当 destroyInactivePanel=true 时，面板收起时会销毁内容，展开时重新渲染。</p>
        <p>当前时间：{new Date().toLocaleTimeString()}</p>
      </div>
    )
  }
}

export const RichContent: Story = {
  args: {
    label: (
      <div className="flex items-center gap-2">
        <Info size={16} />
        <span>详细信息</span>
      </div>
    ),
    extra: (
      <div className="flex gap-2">
        <Button size="sm" variant="flat" color="primary">
          保存
        </Button>
        <Button size="sm" variant="flat">
          取消
        </Button>
      </div>
    ),
    children: (
      <div className="p-4 space-y-4">
        <div>
          <h4 className="font-medium mb-2">基本信息</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">名称</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="请输入名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">类型</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-md">
                <option>选择类型</option>
                <option>类型 A</option>
                <option>类型 B</option>
              </select>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">描述</label>
          <textarea className="w-full px-3 py-2 border border-gray-300 rounded-md" rows={3} placeholder="请输入描述" />
        </div>
      </div>
    )
  }
}

export const MultipleCollapse: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">多个折叠面板</h3>
      <div className="space-y-2">
        <CustomCollapse
          label="面板 1"
          defaultActiveKey={['1']}
          children={
            <div className="p-4">
              <p>第一个面板的内容</p>
            </div>
          }
        />
        <CustomCollapse
          label={
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-yellow-500" />
              <span>警告面板</span>
            </div>
          }
          defaultActiveKey={[]}
          children={
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20">
              <p className="text-yellow-800 dark:text-yellow-200">这是一个警告面板，默认收起状态。</p>
            </div>
          }
        />
        <CustomCollapse
          label="面板 3"
          collapsible="icon"
          extra={<span className="text-sm text-gray-500">仅图标可点击</span>}
          defaultActiveKey={[]}
          children={
            <div className="p-4">
              <p>只能通过点击左侧箭头图标来展开/收起这个面板</p>
            </div>
          }
        />
      </div>
    </div>
  )
}

export const ControlledMode: Story = {
  render: function ControlledMode() {
    const [activeKey, setActiveKey] = useState<string[]>(['1'])

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button size="sm" onPress={() => setActiveKey(['1'])} color={activeKey.includes('1') ? 'primary' : 'default'}>
            展开
          </Button>
          <Button size="sm" onPress={() => setActiveKey([])} color={!activeKey.includes('1') ? 'primary' : 'default'}>
            收起
          </Button>
        </div>
        <CustomCollapse
          label="受控模式"
          activeKey={activeKey}
          onChange={(keys) => setActiveKey(Array.isArray(keys) ? keys : [keys])}
          children={
            <div className="p-4">
              <p>这个面板的展开/收起状态由外部控制</p>
              <p>当前状态：{activeKey.includes('1') ? '展开' : '收起'}</p>
            </div>
          }
        />
      </div>
    )
  }
}
