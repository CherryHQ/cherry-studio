import { Combobox } from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { ChevronDown, User } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof Combobox> = {
  title: 'Components/Primitives/Combobox',
  component: Combobox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A combobox component with search, single/multiple selection support. Based on shadcn/ui.'
      }
    }
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['sm', 'default', 'lg'],
      description: 'The size of the combobox'
    },
    error: {
      control: { type: 'boolean' },
      description: 'Whether the combobox is in error state'
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the combobox is disabled'
    },
    multiple: {
      control: { type: 'boolean' },
      description: 'Enable multiple selection'
    },
    searchable: {
      control: { type: 'boolean' },
      description: 'Enable search functionality'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// Mock data - 根据设计稿中的用户选择场景
const userOptions = [
  {
    value: 'rachel-meyers',
    label: 'Rachel Meyers',
    description: '@rachel',
    icon: (
      <div className="flex size-6 items-center justify-center rounded-full bg-red-500 text-white text-xs font-medium">
        RM
      </div>
    )
  },
  {
    value: 'john-doe',
    label: 'John Doe',
    description: '@john',
    icon: (
      <div className="flex size-6 items-center justify-center rounded-full bg-blue-500 text-white text-xs font-medium">
        JD
      </div>
    )
  },
  {
    value: 'jane-smith',
    label: 'Jane Smith',
    description: '@jane',
    icon: (
      <div className="flex size-6 items-center justify-center rounded-full bg-green-500 text-white text-xs font-medium">
        JS
      </div>
    )
  },
  {
    value: 'alex-chen',
    label: 'Alex Chen',
    description: '@alex',
    icon: (
      <div className="flex size-6 items-center justify-center rounded-full bg-purple-500 text-white text-xs font-medium">
        AC
      </div>
    )
  }
]

// 简单选项数据
const simpleOptions = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3' },
  { value: 'option4', label: 'Option 4' }
]

// 带图标的简单选项
const iconOptions = [
  {
    value: 'user1',
    label: '@rachel',
    icon: <User className="size-4" />
  },
  {
    value: 'user2',
    label: '@john',
    icon: <ChevronDown className="size-4" />
  },
  {
    value: 'user3',
    label: '@jane',
    icon: <User className="size-4" />
  }
]

// ==================== Stories ====================

// Default - 占位符状态
export const Default: Story = {
  args: {
    options: simpleOptions,
    placeholder: 'Please Select',
    width: 280
  }
}

// 带头像和描述 - 对应设计稿顶部的用户选择器
export const WithAvatarAndDescription: Story = {
  args: {
    options: userOptions,
    placeholder: 'Please Select',
    width: 280
  }
}

// 已选中状态 - 对应设计稿中有值的状态
export const WithSelectedValue: Story = {
  args: {
    options: userOptions,
    defaultValue: 'rachel-meyers',
    placeholder: 'Please Select',
    width: 280
  }
}

// 带简单图标 - 对应设计稿中间部分
export const WithSimpleIcon: Story = {
  args: {
    options: iconOptions,
    placeholder: 'Please Select',
    width: 280
  }
}

// 多选模式 - 对应设计稿底部的标签形式
export const MultipleSelection: Story = {
  args: {
    multiple: true,
    options: userOptions,
    placeholder: 'Please Select',
    width: 280
  }
}

// 多选已选中状态
export const MultipleWithSelectedValues: Story = {
  args: {
    multiple: true,
    options: userOptions,
    defaultValue: ['rachel-meyers', 'john-doe'],
    placeholder: 'Please Select',
    width: 280
  }
}

// 所有状态展示 - 对应设计稿的三列（Normal, Focus, Error）
export const AllStates: Story = {
  render: function AllStatesExample() {
    const [normalValue, setNormalValue] = useState('')
    const [selectedValue, setSelectedValue] = useState('rachel-meyers')
    const [errorValue, setErrorValue] = useState('')

    return (
      <div className="flex flex-col gap-6">
        {/* Normal State - 默认灰色边框 */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Normal State</p>
          <Combobox
            options={userOptions}
            value={normalValue}
            onChange={(val) => setNormalValue(val as string)}
            placeholder="Please Select"
            width={280}
          />
        </div>

        {/* Selected State - 绿色边框 (focus 时) */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Selected State</p>
          <Combobox
            options={userOptions}
            value={selectedValue}
            onChange={(val) => setSelectedValue(val as string)}
            placeholder="Please Select"
            width={280}
          />
        </div>

        {/* Error State - 红色边框 */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Error State</p>
          <Combobox
            error
            options={userOptions}
            value={errorValue}
            onChange={(val) => setErrorValue(val as string)}
            placeholder="Please Select"
            width={280}
          />
        </div>

        {/* Disabled State */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Disabled State</p>
          <Combobox
            disabled
            options={userOptions}
            value={selectedValue}
            onChange={(val) => setSelectedValue(val as string)}
            placeholder="Please Select"
            width={280}
          />
        </div>
      </div>
    )
  }
}

// 所有尺寸
export const AllSizes: Story = {
  render: function AllSizesExample() {
    const [value, setValue] = useState('')
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Small</p>
          <Combobox
            size="sm"
            options={simpleOptions}
            value={value}
            onChange={(val) => setValue(val as string)}
            width={280}
          />
        </div>
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Default</p>
          <Combobox
            size="default"
            options={simpleOptions}
            value={value}
            onChange={(val) => setValue(val as string)}
            width={280}
          />
        </div>
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Large</p>
          <Combobox
            size="lg"
            options={simpleOptions}
            value={value}
            onChange={(val) => setValue(val as string)}
            width={280}
          />
        </div>
      </div>
    )
  }
}

// 多选不同状态组合 - 对应设计稿底部区域
export const MultipleStates: Story = {
  render: function MultipleStatesExample() {
    const [normalValue, setNormalValue] = useState<string[]>([])
    const [selectedValue, setSelectedValue] = useState<string[]>(['rachel-meyers', 'john-doe'])
    const [errorValue, setErrorValue] = useState<string[]>(['rachel-meyers'])

    return (
      <div className="flex flex-col gap-6">
        {/* Multiple - Normal */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Multiple - Normal (Empty)</p>
          <Combobox
            multiple
            options={userOptions}
            value={normalValue}
            onChange={(val) => setNormalValue(val as string[])}
            placeholder="Please Select"
            width={280}
          />
        </div>

        {/* Multiple - With Values */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Multiple - With Selected Values</p>
          <Combobox
            multiple
            options={userOptions}
            value={selectedValue}
            onChange={(val) => setSelectedValue(val as string[])}
            placeholder="Please Select"
            width={280}
          />
        </div>

        {/* Multiple - Error */}
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Multiple - Error State</p>
          <Combobox
            multiple
            error
            options={userOptions}
            value={errorValue}
            onChange={(val) => setErrorValue(val as string[])}
            placeholder="Please Select"
            width={280}
          />
        </div>
      </div>
    )
  }
}

// 禁用选项
export const WithDisabledOptions: Story = {
  args: {
    options: [...userOptions.slice(0, 2), { ...userOptions[2], disabled: true }, ...userOptions.slice(3)],
    placeholder: 'Please Select',
    width: 280
  }
}

// 无搜索模式
export const WithoutSearch: Story = {
  args: {
    searchable: false,
    options: simpleOptions,
    width: 280
  }
}

// 实际使用场景 - 综合展示
export const RealWorldExamples: Story = {
  render: function RealWorldExample() {
    const [assignee, setAssignee] = useState('')
    const [members, setMembers] = useState<string[]>([])
    const [status, setStatus] = useState('')

    const statusOptions = [
      { value: 'pending', label: 'Pending', description: 'Waiting for review' },
      { value: 'in-progress', label: 'In Progress', description: 'Currently working' },
      { value: 'completed', label: 'Completed', description: 'Task finished' }
    ]

    return (
      <div className="flex flex-col gap-8">
        {/* 分配任务给单个用户 */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Assign Task</h3>
          <Combobox
            options={userOptions}
            value={assignee}
            onChange={(val) => setAssignee(val as string)}
            placeholder="Select assignee..."
            width={280}
          />
        </div>

        {/* 添加多个成员 */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Add Team Members</h3>
          <Combobox
            multiple
            options={userOptions}
            value={members}
            onChange={(val) => setMembers(val as string[])}
            placeholder="Select members..."
            width={280}
          />
        </div>

        {/* 选择状态 */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Task Status</h3>
          <Combobox
            options={statusOptions}
            value={status}
            onChange={(val) => setStatus(val as string)}
            placeholder="Select status..."
            width={280}
          />
        </div>

        {/* 错误提示场景 */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Required Field (Error)</h3>
          <Combobox
            error
            options={userOptions}
            value=""
            onChange={() => {}}
            placeholder="This field is required"
            width={280}
          />
          <p className="mt-1 text-xs text-destructive">Please select at least one option</p>
        </div>
      </div>
    )
  }
}
