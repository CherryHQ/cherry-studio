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
    },
    searchPlacement: {
      control: { type: 'select' },
      options: ['content', 'trigger'],
      description: 'Where the search input is rendered'
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

const fontOptions = [
  {
    value: 'inter',
    label: 'Inter',
    description: 'Neutral UI sans serif',
    category: 'Sans',
    fontFamily: 'Inter, sans-serif'
  },
  {
    value: 'nunito-sans',
    label: 'Nunito Sans',
    description: 'Friendly rounded sans serif',
    category: 'Sans',
    fontFamily: '"Nunito Sans", sans-serif'
  },
  {
    value: 'geist',
    label: 'Geist',
    description: 'Modern app interface font',
    category: 'Sans',
    fontFamily: 'Geist, sans-serif'
  },
  {
    value: 'system-ui',
    label: 'System UI',
    description: 'Native operating system font',
    category: 'Sans',
    fontFamily: 'system-ui, sans-serif'
  },
  {
    value: 'sf-pro',
    label: 'SF Pro',
    description: 'Apple platform interface font',
    category: 'Sans',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  },
  {
    value: 'roboto',
    label: 'Roboto',
    description: 'Android and Material UI font',
    category: 'Sans',
    fontFamily: 'Roboto, sans-serif'
  },
  {
    value: 'source-sans',
    label: 'Source Sans 3',
    description: 'Readable product copy font',
    category: 'Sans',
    fontFamily: '"Source Sans 3", sans-serif'
  },
  {
    value: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    description: 'Technical and enterprise UI font',
    category: 'Sans',
    fontFamily: '"IBM Plex Sans", sans-serif'
  },
  {
    value: 'geist-mono',
    label: 'Geist Mono',
    description: 'Technical mono for code',
    category: 'Mono',
    fontFamily: '"Geist Mono", monospace'
  },
  {
    value: 'jetbrains-mono',
    label: 'JetBrains Mono',
    description: 'Programming-focused mono font',
    category: 'Mono',
    fontFamily: '"JetBrains Mono", monospace'
  },
  {
    value: 'fira-code',
    label: 'Fira Code',
    description: 'Ligature-friendly code font',
    category: 'Mono',
    fontFamily: '"Fira Code", monospace'
  },
  {
    value: 'source-code-pro',
    label: 'Source Code Pro',
    description: 'Adobe monospace family',
    category: 'Mono',
    fontFamily: '"Source Code Pro", monospace'
  },
  {
    value: 'berkeley-mono',
    label: 'Berkeley Mono',
    description: 'Dense terminal and editor font',
    category: 'Mono',
    fontFamily: '"Berkeley Mono", monospace'
  },
  {
    value: 'ui-monospace',
    label: 'UI Monospace',
    description: 'Native system monospace stack',
    category: 'Mono',
    fontFamily: 'ui-monospace, monospace'
  }
]

const searchableToolOptions = [
  {
    value: 'claude-code',
    label: 'Claude Code',
    description: 'Agentic coding assistant',
    category: 'AI',
    keywords: 'anthropic sonnet terminal'
  },
  {
    value: 'cursor',
    label: 'Cursor',
    description: 'AI-native code editor',
    category: 'Editor',
    keywords: 'autocomplete composer workspace'
  },
  {
    value: 'github-copilot',
    label: 'GitHub Copilot',
    description: 'Inline code completion',
    category: 'AI',
    keywords: 'github suggestion pair programming'
  },
  {
    value: 'raycast',
    label: 'Raycast',
    description: 'Command launcher and extensions',
    category: 'Productivity',
    keywords: 'launcher snippets automation'
  },
  {
    value: 'linear',
    label: 'Linear',
    description: 'Issue tracking and planning',
    category: 'Planning',
    keywords: 'tickets roadmap triage'
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

export const TriggerSearchFontList: Story = {
  render: function TriggerSearchFontListExample() {
    const [font, setFont] = useState('inter')
    const selectedFont = fontOptions.find((option) => option.value === font)

    return (
      <div className="flex w-[360px] flex-col gap-4">
        <Combobox
          options={fontOptions}
          value={font}
          onChange={(val) => setFont(val as string)}
          searchPlacement="trigger"
          placeholder="Select font"
          emptyText="No fonts found"
          width={360}
          renderOption={(option) => (
            <div className="flex w-full items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate" style={{ fontFamily: option.fontFamily }}>
                  {option.label}
                </div>
                <div className="truncate text-muted-foreground text-xs">{option.description}</div>
              </div>
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">{option.category}</span>
            </div>
          )}
        />
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-muted-foreground text-xs">Selected font</div>
          <div className="mt-1 truncate text-sm" style={{ fontFamily: selectedFont?.fontFamily }}>
            {selectedFont?.label}
          </div>
        </div>
      </div>
    )
  }
}

export const CustomFilterOption: Story = {
  render: function CustomFilterOptionExample() {
    const [tool, setTool] = useState('')

    return (
      <Combobox
        options={searchableToolOptions}
        value={tool}
        onChange={(val) => setTool(val as string)}
        placeholder="Search tools"
        searchPlaceholder="Search label, category, or keyword"
        emptyText="No tools found"
        width={320}
        filterOption={(option, search) =>
          [option.label, option.description, option.category, option.keywords]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        }
        renderOption={(option) => (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate">{option.label}</div>
              <div className="truncate text-muted-foreground text-xs">{option.description}</div>
            </div>
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">{option.category}</span>
          </div>
        )}
      />
    )
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
