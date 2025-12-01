import type { Meta, StoryObj } from '@storybook/react'

import {
  Ai302,
  Aihubmix,
  AiOnly,
  Alayanew,
  Anthropic,
  AwsBedrock,
  Azureai,
  Baichuan,
  BaiduCloud,
  Bailian,
  Bocha,
  Burncloud,
  Bytedance,
  Cephalon,
  Cherryin,
  Cohere,
  Dashscope,
  Deepseek,
  Dmxapi,
  Doc2x,
  Doubao,
  Exa,
  Fireworks,
  Gemini,
  GiteeAi,
  Github,
  Google,
  Gpustack,
  GraphRag,
  Grok,
  Groq,
  Huggingface,
  Hyperbolic,
  Infini,
  Intel,
  Jimeng,
  Jina,
  Lanyun,
  Lepton,
  Lmstudio,
  Longcat,
  Macos,
  Mcprouter,
  Meta as MetaLogo,
  Mineru,
  Minimax,
  Mistral,
  Mixedbread,
  Mixedbread1,
  Moonshot,
  NeteaseYoudao,
  Newapi,
  Nomic,
  Nvidia,
  O3,
  Ocoolai,
  Ollama,
  Openai,
  Openrouter,
  Paddleocr,
  Perplexity,
  Ph8,
  Ppio,
  Qiniu,
  Searxng,
  Silicon,
  Sophnet,
  Step,
  Tavily,
  TencentCloudTi,
  TesseractJs,
  Together,
  Tokenflux,
  Vertexai,
  Volcengine,
  Voyage,
  Xirang,
  ZeroOne,
  Zhipu
} from '../../../src/components/icons/logos'

// Logo 列表，包含组件和名称
const logos = [
  { Component: Ai302, name: 'Ai302' },
  { Component: Aihubmix, name: 'Aihubmix' },
  { Component: AiOnly, name: 'AiOnly' },
  { Component: Alayanew, name: 'Alayanew' },
  { Component: Anthropic, name: 'Anthropic' },
  { Component: AwsBedrock, name: 'AwsBedrock' },
  { Component: Azureai, name: 'Azureai' },
  { Component: Baichuan, name: 'Baichuan' },
  { Component: BaiduCloud, name: 'BaiduCloud' },
  { Component: Bailian, name: 'Bailian' },
  { Component: Bocha, name: 'Bocha' },
  { Component: Burncloud, name: 'Burncloud' },
  { Component: Bytedance, name: 'Bytedance' },
  { Component: Cephalon, name: 'Cephalon' },
  { Component: Cherryin, name: 'Cherryin' },
  { Component: Cohere, name: 'Cohere' },
  { Component: Dashscope, name: 'Dashscope' },
  { Component: Deepseek, name: 'Deepseek' },
  { Component: Dmxapi, name: 'Dmxapi' },
  { Component: Doc2x, name: 'Doc2x' },
  { Component: Doubao, name: 'Doubao' },
  { Component: Exa, name: 'Exa' },
  { Component: Fireworks, name: 'Fireworks' },
  { Component: Gemini, name: 'Gemini' },
  { Component: GiteeAi, name: 'GiteeAi' },
  { Component: Github, name: 'Github' },
  { Component: Google, name: 'Google' },
  { Component: Gpustack, name: 'Gpustack' },
  { Component: GraphRag, name: 'GraphRag' },
  { Component: Grok, name: 'Grok' },
  { Component: Groq, name: 'Groq' },
  { Component: Huggingface, name: 'Huggingface' },
  { Component: Hyperbolic, name: 'Hyperbolic' },
  { Component: Infini, name: 'Infini' },
  { Component: Intel, name: 'Intel' },
  { Component: Jimeng, name: 'Jimeng' },
  { Component: Jina, name: 'Jina' },
  { Component: Lanyun, name: 'Lanyun' },
  { Component: Lepton, name: 'Lepton' },
  { Component: Lmstudio, name: 'Lmstudio' },
  { Component: Longcat, name: 'Longcat' },
  { Component: Macos, name: 'Macos' },
  { Component: Mcprouter, name: 'Mcprouter' },
  { Component: MetaLogo, name: 'Meta' },
  { Component: Mineru, name: 'Mineru' },
  { Component: Minimax, name: 'Minimax' },
  { Component: Mistral, name: 'Mistral' },
  { Component: Mixedbread, name: 'Mixedbread' },
  { Component: Mixedbread1, name: 'Mixedbread1' },
  { Component: Moonshot, name: 'Moonshot' },
  { Component: NeteaseYoudao, name: 'NeteaseYoudao' },
  { Component: Newapi, name: 'Newapi' },
  { Component: Nomic, name: 'Nomic' },
  { Component: Nvidia, name: 'Nvidia' },
  { Component: O3, name: 'O3' },
  { Component: Ocoolai, name: 'Ocoolai' },
  { Component: Ollama, name: 'Ollama' },
  { Component: Openai, name: 'Openai' },
  { Component: Openrouter, name: 'Openrouter' },
  { Component: Paddleocr, name: 'Paddleocr' },
  { Component: Perplexity, name: 'Perplexity' },
  { Component: Ph8, name: 'Ph8' },
  { Component: Ppio, name: 'Ppio' },
  { Component: Qiniu, name: 'Qiniu' },
  { Component: Searxng, name: 'Searxng' },
  { Component: Silicon, name: 'Silicon' },
  { Component: Sophnet, name: 'Sophnet' },
  { Component: Step, name: 'Step' },
  { Component: Tavily, name: 'Tavily' },
  { Component: TencentCloudTi, name: 'TencentCloudTi' },
  { Component: TesseractJs, name: 'TesseractJs' },
  { Component: Together, name: 'Together' },
  { Component: Tokenflux, name: 'Tokenflux' },
  { Component: Vertexai, name: 'Vertexai' },
  { Component: Volcengine, name: 'Volcengine' },
  { Component: Voyage, name: 'Voyage' },
  { Component: Xirang, name: 'Xirang' },
  { Component: ZeroOne, name: 'ZeroOne' },
  { Component: Zhipu, name: 'Zhipu' }
]

interface LogosShowcaseProps {
  fontSize?: number
}

const LogosShowcase = ({ fontSize = 32 }: LogosShowcaseProps) => {
  return (
    <div className="flex flex-wrap gap-4 p-2">
      {logos.map(({ Component, name }) => (
        <div key={name} className="flex flex-col items-center justify-center">
          <div className="border-gray-200 border-1 rounded-md p-2 w-min" key={name} style={{ fontSize }}>
            <Component />
          </div>
          <p className="text-sm text-center mt-2">{name}</p>
        </div>
      ))}
    </div>
  )
}

const meta: Meta<typeof LogosShowcase> = {
  title: 'Components/Icons/Logos',
  component: LogosShowcase,
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
type Story = StoryObj<typeof LogosShowcase>

/**
 * 展示所有 81 个品牌 Logo 图标
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
