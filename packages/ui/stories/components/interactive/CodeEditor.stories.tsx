import type { Meta, StoryObj } from '@storybook/react-vite'
import { action } from 'storybook/actions'

import CodeEditor, { getCmThemeByName, getCmThemeNames } from '../../../src/components/interactive/CodeEditor'

const meta: Meta<typeof CodeEditor> = {
  title: 'Interactive/CodeEditor',
  component: CodeEditor,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    language: {
      control: 'select',
      options: ['typescript', 'javascript', 'json', 'markdown', 'python', 'dot', 'mmd']
    },
    theme: {
      control: 'select',
      options: getCmThemeNames()
    },
    fontSize: { control: { type: 'range', min: 12, max: 22, step: 1 } },
    editable: { control: 'boolean' },
    expanded: { control: 'boolean' },
    wrapped: { control: 'boolean' },
    height: { control: 'text' },
    maxHeight: { control: 'text' },
    minHeight: { control: 'text' }
  }
}

export default meta
type Story = StoryObj<typeof meta>

// 基础示例（非流式）
export const Default: Story = {
  args: {
    language: 'typescript',
    theme: 'light',
    value: `function greet(name: string) {\n  return 'Hello ' + name\n}`,
    fontSize: 16,
    editable: true,
    expanded: true,
    wrapped: true
  },
  render: (args) => (
    <div className="w-[720px]">
      <CodeEditor
        value={args.value as string}
        language={args.language as string}
        theme={getCmThemeByName((args as any).theme || 'light')}
        fontSize={args.fontSize as number}
        editable={args.editable as boolean}
        expanded={args.expanded as boolean}
        wrapped={args.wrapped as boolean}
        height={args.height as string | undefined}
        maxHeight={args.maxHeight as string | undefined}
        minHeight={args.minHeight as string | undefined}
        onChange={action('change')}
        onBlur={action('blur')}
        onHeightChange={action('height')}
      />
    </div>
  )
}

// JSON + Lint（非流式）
export const JSONLint: Story = {
  args: {
    language: 'json',
    theme: 'light',
    value: `{\n  "valid": true,\n  "missingComma": true\n  "another": 123\n}`,
    wrapped: true
  },
  render: (args) => (
    <div className="w-[720px]">
      <CodeEditor
        value={args.value as string}
        language="json"
        theme={getCmThemeByName((args as any).theme || 'light')}
        options={{ lint: true }}
        wrapped
        onChange={action('change')}
      />
    </div>
  )
}

// 保存快捷键（Mod/Ctrl + S 触发 onSave）
export const SaveShortcut: Story = {
  args: {
    language: 'markdown',
    theme: 'light',
    value: `# Press Mod/Ctrl + S to fire onSave`,
    wrapped: true
  },
  render: (args) => (
    <div className="w-[720px] space-y-3">
      <CodeEditor
        value={args.value as string}
        language={args.language as string}
        theme={getCmThemeByName((args as any).theme || 'light')}
        options={{ keymap: true }}
        onSave={action('save')}
        onChange={action('change')}
        wrapped
      />
      <p className="text-xs text-gray-500">使用 Mod/Ctrl + S 触发保存事件。</p>
    </div>
  )
}
