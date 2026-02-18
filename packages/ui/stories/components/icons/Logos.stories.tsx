import type { Meta, StoryObj } from '@storybook/react'

import * as Models from '../../../src/components/icons/models'
import * as Providers from '../../../src/components/icons/providers'

interface IconEntry {
  Component: React.ComponentType
  name: string
}

/**
 * Build IconEntry[] from a barrel module's exports.
 * Each export is a compound icon (React component with .Color/.Mono).
 */
function toIconEntries(mod: Record<string, unknown>): IconEntry[] {
  return Object.entries(mod)
    .filter(([, value]) => typeof value === 'function')
    .map(([name, value]) => ({ Component: value as React.ComponentType, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const providerIcons: IconEntry[] = toIconEntries(Providers)
const modelIcons: IconEntry[] = toIconEntries(Models)

interface ShowcaseProps {
  fontSize?: number
}

const IconGrid = ({ icons, fontSize }: { icons: IconEntry[]; fontSize: number }) => (
  <div className="flex flex-wrap gap-4 p-2">
    {icons.map(({ Component, name }) => (
      <div key={name} className="flex flex-col items-center justify-center">
        <div className="border-gray-200 border-1 rounded-md p-2 w-min" style={{ fontSize }}>
          <Component />
        </div>
        <p className="text-sm text-center mt-2">{name}</p>
      </div>
    ))}
  </div>
)

const AllIconsShowcase = ({ fontSize = 32 }: ShowcaseProps) => {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">Providers ({providerIcons.length})</h2>
        <IconGrid icons={providerIcons} fontSize={fontSize} />
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Models ({modelIcons.length})</h2>
        <IconGrid icons={modelIcons} fontSize={fontSize} />
      </div>
    </div>
  )
}

const ColorVsMonoGrid = ({ icons, fontSize }: { icons: IconEntry[]; fontSize: number }) => (
  <div className="flex flex-wrap gap-6 p-2">
    {icons.map(({ Component, name }) => {
      const ColorIcon = (Component as any).Color
      const MonoIcon = (Component as any).Mono
      if (!ColorIcon || !MonoIcon) return null
      return (
        <div key={name} className="flex flex-col items-center gap-1">
          <div className="flex gap-2" style={{ fontSize }}>
            <div className="border-gray-200 border rounded-md p-2">
              <ColorIcon />
            </div>
            <div className="border-gray-200 border rounded-md p-2">
              <MonoIcon />
            </div>
          </div>
          <div className="flex gap-2 text-xs text-gray-400">
            <span>Color</span>
            <span>Mono</span>
          </div>
          <p className="text-sm">{name}</p>
        </div>
      )
    })}
  </div>
)

const AvatarGrid = ({ icons, size }: { icons: IconEntry[]; size: number }) => (
  <div className="flex flex-wrap gap-6 p-2">
    {icons.map(({ Component, name }) => {
      const AvatarComponent = (Component as any).Avatar
      if (!AvatarComponent) return null
      return (
        <div key={name} className="flex flex-col items-center gap-1">
          <div className="flex gap-2">
            <AvatarComponent size={size} shape="circle" />
            <AvatarComponent size={size} shape="rounded" />
          </div>
          <div className="flex gap-2 text-xs text-gray-400">
            <span>Circle</span>
            <span>Rounded</span>
          </div>
          <p className="text-sm">{name}</p>
        </div>
      )
    })}
  </div>
)

const AvatarShowcase = ({ fontSize = 32 }: ShowcaseProps) => {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">Providers ({providerIcons.length})</h2>
        <AvatarGrid icons={providerIcons} size={fontSize} />
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Models ({modelIcons.length})</h2>
        <AvatarGrid icons={modelIcons} size={fontSize} />
      </div>
    </div>
  )
}

const ColorVsMonoShowcase = ({ fontSize = 32 }: ShowcaseProps) => {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">Providers</h2>
        <ColorVsMonoGrid icons={providerIcons} fontSize={fontSize} />
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Models</h2>
        <ColorVsMonoGrid icons={modelIcons} fontSize={fontSize} />
      </div>
    </div>
  )
}

const meta: Meta<typeof AllIconsShowcase> = {
  title: 'Components/Icons/Logos',
  component: AllIconsShowcase,
  parameters: {
    layout: 'fullscreen'
  },
  tags: ['autodocs'],
  argTypes: {
    fontSize: {
      control: { type: 'number', min: 16, max: 64, step: 4 },
      description: 'Logo 大小（通过 fontSize 控制，因为图标使用 1em 单位）',
      defaultValue: 32
    }
  }
}

export default meta
type Story = StoryObj<typeof AllIconsShowcase>

/**
 * 展示所有 Provider 和 Model 图标
 *
 * 这些图标使用 SVGR 的 `icon: true` 选项生成，具有以下特点：
 * - 使用 `width="1em"` 和 `height="1em"`，响应父元素的 `fontSize`
 * - 保留所有原始 SVG 属性（颜色、渐变、clipPath 等）
 * - 支持标准的 SVG props（className, style, onClick 等）
 *
 * ## 使用示例
 *
 * ```tsx
 * import { Anthropic } from '@cherrystudio/ui/icons'
 *
 * // 通过 fontSize 控制大小
 * <div style={{ fontSize: 24 }}>
 *   <Anthropic />
 * </div>
 *
 * // 通过 className 控制（Tailwind）
 * <Anthropic className="text-2xl" />
 *
 * // 使用标准 SVG props
 * <Anthropic className="hover:opacity-80" onClick={handleClick} />
 * ```
 */
export const AllLogos: Story = {
  args: {
    fontSize: 32
  }
}

/**
 * Color 与 Mono 对比展示
 *
 * 每个 Logo 并排展示 Color（彩色）和 Mono（单色）两种变体。
 * Mono 版本使用 `currentColor` 填充，可通过 CSS `color` 属性控制颜色。
 *
 * ```tsx
 * import { Anthropic } from '@cherrystudio/ui/icons'
 *
 * <Anthropic.Color />  // 彩色
 * <Anthropic.Mono />   // 单色
 * ```
 */
export const ColorVsMono: StoryObj<typeof ColorVsMonoShowcase> = {
  render: (args) => <ColorVsMonoShowcase {...args} />,
  args: {
    fontSize: 32
  }
}

/**
 * Avatar 展示
 *
 * 每个 Logo 以 Avatar 形式展示，带有圆形边框。
 * 通过 `size` 控制头像大小，图标自动缩放为容器的 75%。
 *
 * ```tsx
 * import { Anthropic } from '@cherrystudio/ui/icons'
 *
 * <Anthropic.Avatar size={32} />
 * <Anthropic.Avatar size={48} shape="rounded" />
 * ```
 */
export const Avatars: StoryObj<typeof AvatarShowcase> = {
  render: (args) => <AvatarShowcase {...args} />,
  args: {
    fontSize: 32
  }
}
