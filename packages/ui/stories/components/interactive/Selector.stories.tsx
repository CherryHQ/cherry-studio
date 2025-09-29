import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import Selector from '../../../src/components/base/Selector'

const meta: Meta<typeof Selector> = {
  title: 'Interactive/Selector',
  component: Selector,
  parameters: {
    layout: 'padded'
  },
  tags: ['autodocs'],
  argTypes: {
    items: {
      control: false,
      description: '选项数组'
    },
    selectedKeys: {
      control: false,
      description: '选中的键值集合'
    },
    onSelectionChange: {
      control: false,
      description: '选择变化回调函数'
    },
    selectionMode: {
      control: 'select',
      options: ['single', 'multiple'],
      description: '选择模式'
    },
    placeholder: {
      control: 'text',
      description: '占位符文本'
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'HeroUI 大小变体'
    },
    isDisabled: {
      control: 'boolean',
      description: '是否禁用'
    },
    className: {
      control: 'text',
      description: '自定义类名'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// 基础用法
export const Default: Story = {
  render: function Render() {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(['react']))

    return (
      <div className="space-y-4">
        <Selector
          selectedKeys={selectedKeys}
          onSelectionChange={(keys) => setSelectedKeys(new Set(keys.map(String)))}
          placeholder="选择框架"
          items={[
            { value: 'react', label: 'React' },
            { value: 'vue', label: 'Vue' },
            { value: 'angular', label: 'Angular' },
            { value: 'svelte', label: 'Svelte' }
          ]}
        />
        <div className="text-sm text-gray-600">
          当前选择: <code>{Array.from(selectedKeys).join(', ')}</code>
        </div>
      </div>
    )
  }
}

// 多选模式
export const Multiple: Story = {
  render: function Render() {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(['react', 'vue']))

    return (
      <div className="space-y-4">
        <Selector
          selectionMode="multiple"
          selectedKeys={selectedKeys}
          onSelectionChange={(keys) => setSelectedKeys(new Set(keys.map(String)))}
          placeholder="选择多个框架"
          items={[
            { value: 'react', label: 'React' },
            { value: 'vue', label: 'Vue' },
            { value: 'angular', label: 'Angular' },
            { value: 'svelte', label: 'Svelte' },
            { value: 'solid', label: 'Solid' }
          ]}
        />
        <div className="text-sm text-gray-600">
          已选择 ({selectedKeys.size}): {Array.from(selectedKeys).join(', ')}
        </div>
      </div>
    )
  }
}

// 数字值类型
export const NumberValues: Story = {
  render: function Render() {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(['2']))
    const [selectedValue, setSelectedValue] = useState<number>(2)

    return (
      <div className="space-y-4">
        <Selector
          selectedKeys={selectedKeys}
          onSelectionChange={(keys) => {
            setSelectedKeys(new Set(keys.map(String)))
            setSelectedValue(keys[0] as number)
          }}
          placeholder="选择优先级"
          items={[
            { value: 1, label: '🔴 紧急' },
            { value: 2, label: '🟠 高' },
            { value: 3, label: '🟡 中' },
            { value: 4, label: '🟢 低' }
          ]}
        />
        <div className="text-sm text-gray-600">
          优先级值: <code>{selectedValue}</code> (类型: {typeof selectedValue})
        </div>
      </div>
    )
  }
}

// 不同大小
export const Sizes: Story = {
  render: function Render() {
    const items = [
      { value: 'option1', label: '选项 1' },
      { value: 'option2', label: '选项 2' },
      { value: 'option3', label: '选项 3' }
    ]

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm mb-2">小尺寸 (sm)</label>
          <Selector size="sm" placeholder="选择一个选项" items={items} />
        </div>
        <div>
          <label className="block text-sm mb-2">中等尺寸 (md)</label>
          <Selector size="md" placeholder="选择一个选项" items={items} />
        </div>
        <div>
          <label className="block text-sm mb-2">大尺寸 (lg)</label>
          <Selector size="lg" placeholder="选择一个选项" items={items} />
        </div>
      </div>
    )
  }
}

// 禁用状态
export const Disabled: Story = {
  args: {
    isDisabled: true,
    selectedKeys: new Set(['react']),
    placeholder: '禁用的选择器',
    items: [
      { value: 'react', label: 'React' },
      { value: 'vue', label: 'Vue' }
    ]
  }
}

// 实际应用场景：语言选择
export const LanguageSelector: Story = {
  render: function Render() {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(['zh']))

    const languages = [
      { value: 'zh', label: '🇨🇳 简体中文' },
      { value: 'en', label: '🇺🇸 English' },
      { value: 'ja', label: '🇯🇵 日本語' },
      { value: 'ko', label: '🇰🇷 한국어' },
      { value: 'fr', label: '🇫🇷 Français' },
      { value: 'de', label: '🇩🇪 Deutsch' }
    ]

    return (
      <div className="space-y-4">
        <Selector
          selectedKeys={selectedKeys}
          onSelectionChange={(keys) => setSelectedKeys(new Set(keys.map(String)))}
          placeholder="选择语言"
          items={languages}
        />
        <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded">
          当前语言: <strong>{languages.find((l) => l.value === Array.from(selectedKeys)[0])?.label}</strong>
        </div>
      </div>
    )
  }
}
