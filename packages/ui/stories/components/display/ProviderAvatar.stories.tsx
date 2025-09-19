import type { Meta, StoryObj } from '@storybook/react'

import { ProviderAvatar } from '../../../src/components/display/ProviderAvatar'

// 定义 Story 的元数据
const meta: Meta<typeof ProviderAvatar> = {
  title: 'Display/ProviderAvatar',
  component: ProviderAvatar,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'range', min: 16, max: 128, step: 4 },
      description: '头像尺寸',
      defaultValue: 40
    },
    providerId: {
      control: 'text',
      description: '提供商 ID'
    },
    providerName: {
      control: 'text',
      description: '提供商名称'
    },
    logoSrc: {
      control: 'text',
      description: '图片 Logo 地址'
    },
    className: {
      control: 'text',
      description: '自定义类名'
    }
  }
} satisfies Meta<typeof ProviderAvatar>

export default meta
type Story = StoryObj<typeof meta>

// 基础用法：文字头像
export const Default: Story = {
  args: {
    providerId: 'openai',
    providerName: 'OpenAI',
    size: 40
  }
}

// 带图片的头像
export const WithImage: Story = {
  args: {
    providerId: 'custom',
    providerName: 'Custom Provider',
    logoSrc: 'https://via.placeholder.com/150',
    size: 40
  }
}

// 不同尺寸展示
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <ProviderAvatar {...args} providerName="Small" size="sm" />
      <ProviderAvatar {...args} providerName="Medium" size="md" />
      <ProviderAvatar {...args} providerName="Large" size="lg" />
      <ProviderAvatar {...args} providerName="24px" size={24} />
      <ProviderAvatar {...args} providerName="48px" size={48} />
      <ProviderAvatar {...args} providerName="72px" size={72} />
    </div>
  ),
  args: {
    providerId: 'size-demo'
  }
}

// 不同首字母的颜色生成
export const ColorGeneration: Story = {
  args: {
    providerId: 'azure',
    providerName: 'Azure',
    size: 40
  },
  render: (args) => (
    <div className="flex items-center gap-4">
      <ProviderAvatar {...args} providerId="azure" providerName="Azure" size={40} />
      <ProviderAvatar {...args} providerId="anthropic" providerName="Anthropic" size={40} />
      <ProviderAvatar {...args} providerId="baidu" providerName="Baidu" size={40} />
      <ProviderAvatar {...args} providerId="google" providerName="Google" size={40} />
      <ProviderAvatar {...args} providerId="meta" providerName="Meta" size={40} />
      <ProviderAvatar {...args} providerId="openai" providerName="OpenAI" size={40} />
      <ProviderAvatar {...args} providerId="perplexity" providerName="Perplexity" size={40} />
      <ProviderAvatar {...args} providerId="zhipu" providerName="智谱" size={40} />
      <ProviderAvatar {...args} providerId="alibaba" providerName="阿里云" size={40} />
      <ProviderAvatar {...args} providerId="tencent" providerName="腾讯云" size={40} />
    </div>
  )
}

// 自定义 SVG Logo
export const WithCustomSvg: Story = {
  args: {
    providerId: 'custom-svg',
    providerName: 'Custom SVG',
    size: 40,
    renderCustomLogo: () => (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" />
        <path d="M2 17L12 22L22 17L12 12L2 17Z" />
        <path d="M2 12L12 17L22 12L12 7L2 12Z" />
      </svg>
    )
  }
}

// 混合展示
export const Mixed: Story = {
  args: {
    providerId: 'text',
    providerName: 'Text Avatar',
    size: 40
  },
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <ProviderAvatar {...args} providerId="text" providerName="Text Avatar" size={40} />
      <ProviderAvatar
        {...args}
        providerId="image"
        providerName="Image Avatar"
        logoSrc="https://via.placeholder.com/150/0000FF/FFFFFF?text=IMG"
        size={40}
      />
      <ProviderAvatar
        {...args}
        providerId="svg"
        providerName="SVG Avatar"
        size={40}
        renderCustomLogo={() => (
          <svg viewBox="0 0 24 24" fill="#FF6B6B">
            <circle cx="12" cy="12" r="10" />
          </svg>
        )}
      />
    </div>
  )
}

// 空值处理
export const EmptyValues: Story = {
  args: {
    providerId: 'empty',
    providerName: '',
    size: 40
  },
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <div>
        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>空名称</p>
        <ProviderAvatar {...args} providerId="empty" providerName="" size={40} />
      </div>
      <div>
        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>正常显示</p>
        <ProviderAvatar {...args} providerId="normal" providerName="Normal" size={40} />
      </div>
    </div>
  )
}

// 自定义样式
export const CustomStyle: Story = {
  args: {
    providerId: 'custom-style',
    providerName: 'Custom',
    size: 40,
    style: {
      border: '2px solid #FF6B6B',
      boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
    }
  }
}

// 响应式网格展示
export const ResponsiveGrid: Story = {
  args: {
    providerId: 'provider-a',
    providerName: 'Provider A',
    size: 48
  },
  render: (args) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
        gap: '16px',
        width: '400px'
      }}>
      {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((letter) => (
        <div key={letter} style={{ textAlign: 'center' }}>
          <ProviderAvatar
            {...args}
            providerId={`provider-${letter.toLowerCase()}`}
            providerName={`Provider ${letter}`}
            size={48}
          />
          <div style={{ fontSize: '12px', marginTop: '4px', color: '#666' }}>{letter}</div>
        </div>
      ))}
    </div>
  )
}
