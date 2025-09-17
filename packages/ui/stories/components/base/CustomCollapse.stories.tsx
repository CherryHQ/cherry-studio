import { Button } from '@heroui/react'
import type { Meta, StoryObj } from '@storybook/react'
import { AlertTriangle, CreditCard, Info, Monitor, Settings, Shield } from 'lucide-react'
import { useState } from 'react'

import CustomCollapse, { Accordion, AccordionItem } from '../../../src/components/base/CustomCollapse'

const meta: Meta<typeof CustomCollapse> = {
  title: 'Base/CustomCollapse',
  component: CustomCollapse,
  parameters: {
    layout: 'padded'
  },
  tags: ['autodocs'],
  argTypes: {
    children: {
      control: false,
      description: '面板内容'
    },
    accordionProps: {
      control: false,
      description: 'Accordion 组件的属性'
    },
    accordionItemProps: {
      control: false,
      description: 'AccordionItem 组件的属性'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// 基础用法
export const Default: Story = {
  args: {
    accordionItemProps: {
      title: '默认折叠面板'
    },
    children: (
      <div className="p-4">
        <p>这是折叠面板的内容。</p>
        <p>可以包含任何内容，包括文本、图片、表单等。</p>
      </div>
    )
  }
}

// 带副标题
export const WithSubtitle: Story = {
  args: {
    accordionProps: {
      defaultExpandedKeys: ['1']
    },
    accordionItemProps: {
      title: '带副标题的折叠面板',
      subtitle: <span className="text-sm text-gray-500">这是副标题内容</span>
    },
    children: (
      <div className="p-4">
        <p>面板内容</p>
        <p>可以在 subtitle 属性中设置副标题</p>
      </div>
    )
  }
}

// HeroUI 样式变体
export const VariantLight: Story = {
  args: {
    accordionProps: {
      variant: 'light'
    },
    accordionItemProps: {
      title: 'Light 变体'
    },
    children: (
      <div className="p-4">
        <p>这是 HeroUI 的 Light 变体样式。</p>
      </div>
    )
  }
}

export const VariantShadow: Story = {
  args: {
    accordionProps: {
      variant: 'shadow',
      className: 'p-2'
    },
    accordionItemProps: {
      title: 'Shadow 变体',
      subtitle: '带阴影的面板样式'
    },
    children: (
      <div className="p-4">
        <p>这是 HeroUI 的 Shadow 变体样式。</p>
      </div>
    )
  }
}

export const VariantBordered: Story = {
  args: {
    accordionProps: {
      variant: 'bordered'
    },
    accordionItemProps: {
      title: 'Bordered 变体（默认）'
    },
    children: (
      <div className="p-4">
        <p>这是 HeroUI 的 Bordered 变体样式。</p>
      </div>
    )
  }
}

export const VariantSplitted: Story = {
  args: {
    accordionProps: {
      variant: 'splitted'
    },
    accordionItemProps: {
      title: 'Splitted 变体'
    },
    children: (
      <div className="p-4">
        <p>这是 HeroUI 的 Splitted 变体样式。</p>
      </div>
    )
  }
}

// 富内容标题
export const RichLabel: Story = {
  args: {
    accordionItemProps: {
      title: (
        <div className="flex items-center gap-2">
          <Settings className="text-default-500" size={20} />
          <span>设置面板</span>
        </div>
      )
    },
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

// 带警告提示
export const WithWarning: Story = {
  args: {
    accordionItemProps: {
      title: (
        <div className="flex items-center gap-2">
          <Monitor className="text-primary" size={20} />
          <span>连接的设备</span>
        </div>
      ),
      subtitle: (
        <p className="flex">
          2个问题需要<span className="text-primary ml-1">立即修复</span>
        </p>
      )
    },
    children: (
      <div className="p-4">
        <p className="text-small">检测到以下设备连接异常：</p>
        <ul className="list-disc list-inside mt-2 text-small space-y-1">
          <li>外部显示器连接不稳定</li>
          <li>蓝牙键盘配对失败</li>
        </ul>
      </div>
    )
  }
}

// 禁用状态
export const Disabled: Story = {
  args: {
    accordionProps: {
      isDisabled: true,
      defaultExpandedKeys: ['1']
    },
    accordionItemProps: {
      title: '禁用的折叠面板'
    },
    children: (
      <div className="p-4">
        <p>这个面板被禁用了，无法操作。</p>
      </div>
    )
  }
}

// 受控模式
export const ControlledMode: Story = {
  render: function ControlledMode() {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(['1']))

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button size="sm" onPress={() => setSelectedKeys(new Set(['1']))} color="primary">
            展开
          </Button>
          <Button size="sm" onPress={() => setSelectedKeys(new Set())} color="default">
            收起
          </Button>
        </div>
        <CustomCollapse
          accordionProps={{
            selectedKeys,
            onSelectionChange: (keys) => {
              if (keys !== 'all') {
                setSelectedKeys(keys as Set<string>)
              }
            }
          }}
          accordionItemProps={{
            title: '受控的折叠面板'
          }}>
          <div className="p-4">
            <p>这是一个受控的折叠面板</p>
            <p>通过按钮控制展开和收起状态</p>
          </div>
        </CustomCollapse>
        <div className="text-sm text-gray-600">当前状态：{selectedKeys.size > 0 ? '展开' : '收起'}</div>
      </div>
    )
  }
}

// 多个单面板组合
export const MultipleSinglePanels: Story = {
  render: () => (
    <div className="space-y-4">
      <CustomCollapse accordionProps={{ defaultExpandedKeys: ['1'] }} accordionItemProps={{ title: '第一个面板' }}>
        <div className="p-4">
          <p>第一个面板的内容</p>
        </div>
      </CustomCollapse>
      <CustomCollapse
        accordionItemProps={{
          title: '第二个面板',
          subtitle: '带副标题'
        }}>
        <div className="p-4">
          <p>第二个面板的内容</p>
        </div>
      </CustomCollapse>
      <CustomCollapse accordionProps={{ isDisabled: true }} accordionItemProps={{ title: '第三个面板（禁用）' }}>
        <div className="p-4">
          <p>这个面板被禁用了</p>
        </div>
      </CustomCollapse>
    </div>
  )
}

// 使用原生 HeroUI Accordion 的多面板示例
export const NativeAccordionMultiple: Story = {
  render: () => (
    <div className="max-w-lg">
      <h3 className="text-lg font-medium mb-4">原生 HeroUI Accordion 多面板</h3>
      <Accordion variant="shadow" className="p-2 flex flex-col gap-1" defaultExpandedKeys={['1']}>
        <AccordionItem
          key="1"
          title="连接的设备"
          startContent={<Monitor className="text-primary" size={20} />}
          subtitle={
            <p className="flex">
              2个问题需要<span className="text-primary ml-1">立即修复</span>
            </p>
          }>
          <div className="p-4">
            <p className="text-small">设备连接状态监控</p>
          </div>
        </AccordionItem>
        <AccordionItem
          key="2"
          title="应用权限"
          startContent={<Shield className="text-default-500" size={20} />}
          subtitle="3个应用有读取权限">
          <div className="p-4">
            <p className="text-small">管理应用的系统权限设置</p>
          </div>
        </AccordionItem>
        <AccordionItem
          key="3"
          title="待办任务"
          startContent={<Info className="text-warning" size={20} />}
          subtitle={<span className="text-warning">请完善您的个人资料</span>}>
          <div className="p-4">
            <p className="text-small">您还有一些信息需要完善</p>
          </div>
        </AccordionItem>
        <AccordionItem
          key="4"
          title={
            <p className="flex gap-1 items-center">
              卡片已过期
              <span className="text-default-400 text-small">*4812</span>
            </p>
          }
          startContent={<CreditCard className="text-danger" size={20} />}
          subtitle={<span className="text-danger">请立即更新</span>}>
          <div className="p-4">
            <p className="text-small text-danger">您的信用卡已过期，请更新支付信息</p>
          </div>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

// 富内容面板
export const RichContent: Story = {
  args: {
    accordionItemProps: {
      title: (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Info className="text-default-500" size={20} />
            <span>详细信息</span>
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="flat" color="primary">
              保存
            </Button>
            <Button size="sm" variant="flat">
              取消
            </Button>
          </div>
        </div>
      )
    },
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

// 自定义样式
export const CustomStyles: Story = {
  args: {
    accordionProps: {
      style: {
        backgroundColor: 'rgba(255, 193, 7, 0.1)',
        borderColor: 'var(--color-warning)'
      }
    },
    accordionItemProps: {
      title: (
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-warning" size={16} />
          <span>警告面板</span>
        </div>
      )
    },
    children: (
      <div className="p-4 bg-warning-50 dark:bg-warning-900/20">
        <p className="text-warning-800 dark:text-warning-200">这是一个带有自定义样式的警告面板。</p>
      </div>
    )
  }
}

// 原生 HeroUI Accordion 多面板受控模式
export const NativeAccordionControlled: Story = {
  render: function NativeAccordionControlled() {
    const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set(['1']))

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button size="sm" onPress={() => setActiveKeys(new Set(['1', '2', '3']))} color="primary">
            全部展开
          </Button>
          <Button size="sm" onPress={() => setActiveKeys(new Set())} color="default">
            全部收起
          </Button>
          <Button size="sm" onPress={() => setActiveKeys(new Set(['2']))} color="default">
            只展开第二个
          </Button>
        </div>
        <Accordion
          selectedKeys={activeKeys}
          onSelectionChange={(keys) => {
            if (keys !== 'all') {
              setActiveKeys(keys as Set<string>)
            }
          }}>
          <AccordionItem key="1" title="受控面板 1">
            <div className="p-4">
              <p>第一个面板的内容</p>
            </div>
          </AccordionItem>
          <AccordionItem key="2" title="受控面板 2">
            <div className="p-4">
              <p>第二个面板的内容</p>
            </div>
          </AccordionItem>
          <AccordionItem key="3" title="受控面板 3">
            <div className="p-4">
              <p>第三个面板的内容</p>
            </div>
          </AccordionItem>
        </Accordion>
        <div className="text-sm text-gray-600">
          当前展开的面板：{activeKeys.size > 0 ? Array.from(activeKeys).join(', ') : '无'}
        </div>
      </div>
    )
  }
}
