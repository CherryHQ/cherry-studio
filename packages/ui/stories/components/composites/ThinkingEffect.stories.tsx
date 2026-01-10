import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '../../../src/components'
import { ThinkingEffect } from '../../../src/components'

const meta: Meta<typeof ThinkingEffect> = {
  title: 'Components/Composites/ThinkingEffect',
  component: ThinkingEffect,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          '⚠️ **已废弃** - 此组件使用频率仅为 1 次，不符合 UI 库提取标准（需 ≥3 次）。计划在未来版本中移除。此组件是 AI 思考特效，可能需要保留在主项目中而不是 UI 库。\n\n一个用于显示AI思考过程的动画组件，包含灯泡动画、思考内容滚动展示和展开收缩功能。'
      }
    }
  },
  tags: ['autodocs', 'deprecated'],
  argTypes: {
    isThinking: {
      control: { type: 'boolean' },
      description: '是否正在思考，控制动画状态和内容显示'
    },
    thinkingTimeText: {
      control: { type: 'text' },
      description: '思考时间文本，显示在组件顶部'
    },
    content: {
      control: { type: 'text' },
      description: '思考内容，多行文本用换行符分隔，最后一行在思考时会被过滤'
    },
    expanded: {
      control: { type: 'boolean' },
      description: '是否展开状态，影响组件的显示样式'
    },
    className: {
      control: { type: 'text' },
      description: '自定义 CSS 类名'
    }
  },
  args: {
    isThinking: true,
    thinkingTimeText: '思考中...',
    content: `正在分析问题\n寻找最佳解决方案\n整理思路和逻辑\n准备回答`,
    expanded: false
  }
} satisfies Meta<typeof ThinkingEffect>

export default meta
type Story = StoryObj<typeof meta>

// 默认思考状态
export const Default: Story = {
  args: {
    isThinking: true,
    thinkingTimeText: '思考中 2s',
    content: `正在分析用户的问题\n查找相关信息\n整理回答思路`,
    expanded: false
  },
  render: (args) => (
    <div className="w-96">
      <ThinkingEffect {...args} />
    </div>
  )
}

// 非思考状态（静止）
export const NotThinking: Story = {
  args: {
    isThinking: false,
    thinkingTimeText: '思考完成',
    content: `已完成思考\n找到最佳答案\n准备响应`,
    expanded: false
  },
  render: (args) => (
    <div className="w-96">
      <ThinkingEffect {...args} />
    </div>
  )
}

// 展开状态
export const Expanded: Story = {
  args: {
    isThinking: false,
    thinkingTimeText: '思考用时 5s',
    content: `第一步：理解问题本质\n第二步：分析可能的解决方案\n第三步：评估各方案的优缺点\n第四步：选择最优方案\n第五步：构建详细回答`,
    expanded: true
  },
  render: (args) => (
    <div className="w-96">
      <ThinkingEffect {...args} />
    </div>
  )
}

// 交互式演示
export const Interactive: Story = {
  render: function Render() {
    const [isThinking, setIsThinking] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [thinkingTime, setThinkingTime] = useState(0)

    const thinkingSteps = useMemo(() => {
      return [
        '开始分析问题...',
        '查找相关资料和信息',
        '对比不同的解决方案',
        '评估方案的可行性',
        '选择最佳解决路径',
        '构建完整的回答框架',
        '检查逻辑的连贯性',
        '优化回答的表达方式'
      ]
    }, [])

    const [content, setContent] = useState('')

    useEffect(() => {
      let interval: NodeJS.Timeout
      if (isThinking) {
        setThinkingTime(0)
        setContent(thinkingSteps[0])

        interval = setInterval(() => {
          setThinkingTime((prev) => {
            const newTime = prev + 1
            const stepIndex = Math.min(Math.floor(newTime / 2), thinkingSteps.length - 1)
            const currentSteps = thinkingSteps.slice(0, stepIndex + 1)
            setContent(currentSteps.join('\n'))
            return newTime
          })
        }, 1000)
      }

      return () => {
        if (interval) clearInterval(interval)
      }
    }, [isThinking, thinkingSteps])

    const handleStartThinking = () => {
      setIsThinking(true)
      setExpanded(false)
    }

    const handleStopThinking = () => {
      setIsThinking(false)
    }

    const handleToggleExpanded = () => {
      setExpanded(!expanded)
    }

    return (
      <div className="w-96 space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" color="primary" onClick={handleStartThinking} disabled={isThinking}>
            开始思考
          </Button>
          <Button size="sm" color="secondary" onClick={handleStopThinking} disabled={!isThinking}>
            停止思考
          </Button>
          <Button size="sm" variant="ghost" onClick={handleToggleExpanded}>
            {expanded ? '收起' : '展开'}
          </Button>
        </div>

        <ThinkingEffect
          isThinking={isThinking}
          thinkingTimeText={isThinking ? `思考中 ${thinkingTime}s` : `思考完成 ${thinkingTime}s`}
          content={content}
          expanded={expanded}
        />
      </div>
    )
  }
}

// 不同内容长度
export const DifferentContentLength: Story = {
  render: () => (
    <div className="space-y-6 w-96">
      <div>
        <h3 className="text-sm font-medium mb-2">短内容</h3>
        <ThinkingEffect isThinking thinkingTimeText="思考中 1s" content={`分析问题\n寻找答案`} expanded={false} />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">中等长度内容</h3>
        <ThinkingEffect
          isThinking
          thinkingTimeText="思考中 3s"
          content={`第一步：理解问题\n第二步：分析背景\n第三步：寻找解决方案\n第四步：验证方案可行性\n第五步：准备详细回答`}
          expanded={false}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">长内容</h3>
        <ThinkingEffect
          isThinking
          thinkingTimeText="思考中 8s"
          content={`开始分析用户提出的复杂问题\n识别问题的核心要素和关键词\n搜索相关的知识领域和概念\n整理可能的解决思路和方法\n评估不同方案的优缺点\n考虑实际应用中的限制条件\n构建逻辑清晰的回答框架\n检查答案的完整性和准确性\n优化语言表达的清晰度`}
          expanded={false}
        />
      </div>
    </div>
  )
}

// 不同的思考时间文本
export const DifferentThinkingTime: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <ThinkingEffect
        isThinking
        thinkingTimeText="思考中..."
        content={`正在处理问题\n分析可能的答案`}
        expanded={false}
      />

      <ThinkingEffect
        isThinking
        thinkingTimeText="深度思考中 10s"
        content={`进行复杂分析\n考虑多种可能性`}
        expanded={false}
      />

      <ThinkingEffect
        isThinking={false}
        thinkingTimeText="🎯 思考完成 (用时 15s)"
        content={`问题分析完毕\n答案已准备就绪`}
        expanded={false}
      />

      <ThinkingEffect
        isThinking={false}
        thinkingTimeText={
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-xs">✓</span>
            <span>思考完成</span>
          </div>
        }
        content={`成功找到解决方案\n可以开始回答`}
        expanded={false}
      />
    </div>
  )
}

// 空内容状态
export const EmptyContent: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <div>
        <h3 className="text-sm font-medium mb-2">无内容 - 思考中</h3>
        <ThinkingEffect isThinking thinkingTimeText="准备开始思考..." content="" expanded={false} />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">无内容 - 停止思考</h3>
        <ThinkingEffect isThinking={false} thinkingTimeText="等待输入" content="" expanded={false} />
      </div>
    </div>
  )
}

// 实时内容更新演示
export const RealTimeUpdate: Story = {
  render: function Render() {
    const [content, setContent] = useState('')
    const [isThinking, setIsThinking] = useState(false)
    const [step, setStep] = useState(0)

    const steps = useMemo(() => {
      return [
        '开始分析问题的复杂性...',
        '识别关键信息和要求',
        '搜索相关的知识点',
        '整理可能的解决思路',
        '评估不同方案的优缺点',
        '选择最优的解决方案',
        '构建详细的回答框架',
        '检查逻辑的连贯性',
        '优化表达的清晰度',
        '完成最终答案的准备'
      ]
    }, [])

    useEffect(() => {
      if (isThinking && step < steps.length) {
        const timer = setTimeout(() => {
          const newContent = steps.slice(0, step + 1).join('\n')
          setContent(newContent)
          setStep((prev) => prev + 1)
        }, 1500)

        return () => clearTimeout(timer)
      } else if (step >= steps.length) {
        setIsThinking(false)
      }

      return undefined
    }, [isThinking, step, steps])

    const handleStart = () => {
      setIsThinking(true)
      setStep(0)
      setContent('')
    }

    const handleReset = () => {
      setIsThinking(false)
      setStep(0)
      setContent('')
    }

    return (
      <div className="w-96 space-y-4">
        <div className="flex gap-2">
          <Button size="sm" color="primary" onClick={handleStart} disabled={isThinking}>
            开始实时思考
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset}>
            重置
          </Button>
        </div>

        <ThinkingEffect
          isThinking={isThinking}
          thinkingTimeText={isThinking ? `思考中... 步骤 ${step}/${steps.length}` : '思考完成'}
          content={content}
          expanded={false}
        />
      </div>
    )
  }
}

// 自定义样式
export const CustomStyles: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <div>
        <h3 className="text-sm font-medium mb-2">自定义边框和背景</h3>
        <ThinkingEffect
          isThinking={true}
          thinkingTimeText="自定义样式思考中..."
          content="应用自定义样式\n测试视觉效果"
          expanded={false}
          className="border-blue-300 bg-blue-50 dark:bg-blue-950"
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">圆角和阴影</h3>
        <ThinkingEffect
          isThinking={false}
          thinkingTimeText="思考完成"
          content="圆角和阴影效果\n增强视觉体验"
          expanded={false}
          className="rounded-2xl shadow-lg border-purple-300 bg-purple-50 dark:bg-purple-950"
        />
      </div>
    </div>
  )
}

// 错误和边界情况
export const EdgeCases: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <div>
        <h3 className="text-sm font-medium mb-2">单行内容</h3>
        <ThinkingEffect isThinking thinkingTimeText="思考中..." content="只有一行内容" expanded={false} />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">超长单行</h3>
        <ThinkingEffect
          isThinking
          thinkingTimeText="处理长文本..."
          content={`这是一行非常长的文本内容，用于测试组件在处理超长单行文本时的表现，看看是否能正确处理文本溢出和省略`}
          expanded={false}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">特殊字符</h3>
        <ThinkingEffect
          isThinking
          thinkingTimeText="特殊字符测试"
          content={`包含特殊字符: @#$%^&*()_+\n中文、English、数字123\n换行\t制表符测试`}
          expanded={false}
        />
      </div>
    </div>
  )
}
