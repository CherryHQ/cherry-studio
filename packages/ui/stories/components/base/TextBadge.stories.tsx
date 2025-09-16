import type { Meta, StoryObj } from '@storybook/react'

import TextBadge from '../../../src/components/base/TextBadge'

const meta: Meta<typeof TextBadge> = {
  title: 'Base/TextBadge',
  component: TextBadge,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    text: {
      control: 'text',
      description: '徽章显示的文字'
    },
    style: {
      control: false,
      description: '自定义样式对象'
    }
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    text: '新'
  }
}

export const ShortText: Story = {
  args: {
    text: 'V2'
  }
}

export const LongText: Story = {
  args: {
    text: '热门推荐'
  }
}

export const Numbers: Story = {
  args: {
    text: '99+'
  }
}

export const Status: Story = {
  args: {
    text: '已完成'
  }
}

export const Version: Story = {
  args: {
    text: 'v1.2.0'
  }
}

export const CustomStyle: Story = {
  args: {
    text: '自定义',
    style: {
      backgroundColor: '#10b981',
      color: 'white',
      fontSize: '11px'
    }
  }
}

export const CustomClassName: Story = {
  args: {
    text: '特殊样式',
    className:
      'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-700'
  }
}

export const ColorVariations: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">颜色变化</h3>
      <div className="flex flex-wrap gap-3">
        <TextBadge text="默认蓝色" />
        <TextBadge text="绿色" className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" />
        <TextBadge text="红色" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
        <TextBadge text="黄色" className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400" />
        <TextBadge text="紫色" className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" />
        <TextBadge text="灰色" className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400" />
      </div>
    </div>
  )
}

export const StatusBadges: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">状态徽章</h3>
      <div className="space-y-4">
        <div>
          <h4 className="font-medium mb-2">任务状态</h4>
          <div className="flex flex-wrap gap-2">
            <TextBadge text="待处理" className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400" />
            <TextBadge text="进行中" className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
            <TextBadge text="已完成" className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" />
            <TextBadge text="已取消" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-2">优先级</h4>
          <div className="flex flex-wrap gap-2">
            <TextBadge text="低" className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400" />
            <TextBadge text="中" />
            <TextBadge text="高" className="bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" />
            <TextBadge text="紧急" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-2">类型标签</h4>
          <div className="flex flex-wrap gap-2">
            <TextBadge text="功能" />
            <TextBadge text="修复" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
            <TextBadge text="优化" className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" />
            <TextBadge
              text="文档"
              className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const InUserInterface: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">界面应用示例</h3>

      <div className="space-y-4">
        {/* 导航菜单 */}
        <div>
          <h4 className="font-medium mb-2">导航菜单</h4>
          <nav className="flex gap-4">
            <div className="flex items-center gap-2">
              <span>首页</span>
            </div>
            <div className="flex items-center gap-2">
              <span>产品</span>
              <TextBadge text="新" />
            </div>
            <div className="flex items-center gap-2">
              <span>消息</span>
              <TextBadge text="5" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex items-center gap-2">
              <span>设置</span>
            </div>
          </nav>
        </div>

        {/* 卡片列表 */}
        <div>
          <h4 className="font-medium mb-2">文章列表</h4>
          <div className="space-y-3">
            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h5 className="font-medium">React 18 新特性介绍</h5>
                  <p className="text-sm text-gray-500 mt-1">介绍 React 18 的并发特性...</p>
                </div>
                <div className="flex gap-2 ml-4">
                  <TextBadge text="前端" />
                  <TextBadge
                    text="推荐"
                    className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h5 className="font-medium">Node.js 性能优化指南</h5>
                  <p className="text-sm text-gray-500 mt-1">深入了解 Node.js 性能优化...</p>
                </div>
                <div className="flex gap-2 ml-4">
                  <TextBadge text="后端" />
                  <TextBadge text="热门" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </div>

            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h5 className="font-medium">TypeScript 最佳实践</h5>
                  <p className="text-sm text-gray-500 mt-1">TypeScript 开发的最佳实践...</p>
                </div>
                <div className="flex gap-2 ml-4">
                  <TextBadge text="TypeScript" />
                  <TextBadge text="新" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 用户列表 */}
        <div>
          <h4 className="font-medium mb-2">团队成员</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm">
                  张
                </div>
                <div>
                  <p className="font-medium">张三</p>
                  <p className="text-sm text-gray-500">前端开发</p>
                </div>
              </div>
              <div className="flex gap-2">
                <TextBadge
                  text="管理员"
                  className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                />
                <TextBadge
                  text="在线"
                  className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm">
                  李
                </div>
                <div>
                  <p className="font-medium">李四</p>
                  <p className="text-sm text-gray-500">后端开发</p>
                </div>
              </div>
              <div className="flex gap-2">
                <TextBadge text="成员" />
                <TextBadge text="离线" className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const VersionTags: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">版本标签</h3>
      <div className="space-y-4">
        <div>
          <h4 className="font-medium mb-2">软件版本</h4>
          <div className="flex flex-wrap gap-2">
            <TextBadge text="v1.0.0" />
            <TextBadge text="v1.1.0" />
            <TextBadge text="v2.0.0-beta" />
            <TextBadge text="v2.1.0" className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" />
            <TextBadge text="latest" className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-2">环境标签</h4>
          <div className="flex flex-wrap gap-2">
            <TextBadge text="开发" className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
            <TextBadge
              text="测试"
              className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
            />
            <TextBadge
              text="预发布"
              className="bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
            />
            <TextBadge text="生产" className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" />
          </div>
        </div>
      </div>
    </div>
  )
}

export const NumberBadges: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">数字徽章</h3>
      <div className="space-y-4">
        <div>
          <h4 className="font-medium mb-2">通知数量</h4>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span>消息</span>
              <TextBadge text="3" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex items-center gap-2">
              <span>任务</span>
              <TextBadge text="12" className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex items-center gap-2">
              <span>评论</span>
              <TextBadge text="99+" className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-medium mb-2">统计数据</h4>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span>访问量</span>
              <TextBadge text="1.2K" />
            </div>
            <div className="flex items-center gap-2">
              <span>下载</span>
              <TextBadge text="856" />
            </div>
            <div className="flex items-center gap-2">
              <span>收藏</span>
              <TextBadge text="234" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const SizeVariations: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">尺寸变化</h3>
      <div className="flex items-center gap-4">
        <TextBadge text="超小" style={{ fontSize: '10px', padding: '1px 4px' }} />
        <TextBadge text="小" style={{ fontSize: '11px', padding: '2px 6px' }} />
        <TextBadge text="默认" />
        <TextBadge text="大" style={{ fontSize: '14px', padding: '4px 8px' }} />
        <TextBadge text="超大" style={{ fontSize: '16px', padding: '6px 12px' }} />
      </div>
    </div>
  )
}

export const OutlineBadges: Story = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">边框样式</h3>
      <div className="flex flex-wrap gap-3">
        <TextBadge
          text="边框"
          className="bg-transparent border border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
        />
        <TextBadge
          text="绿色边框"
          className="bg-transparent border border-green-600 text-green-600 dark:border-green-400 dark:text-green-400"
        />
        <TextBadge
          text="红色边框"
          className="bg-transparent border border-red-600 text-red-600 dark:border-red-400 dark:text-red-400"
        />
        <TextBadge
          text="虚线边框"
          className="bg-transparent border border-dashed border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-400"
        />
      </div>
    </div>
  )
}
