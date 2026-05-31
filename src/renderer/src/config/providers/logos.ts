import type { AtLeast, SystemProviderId } from '@renderer/types'

import ZhinaoProviderLogo from '@renderer/assets/images/models/360.png'
import HunyuanProviderLogo from '@renderer/assets/images/models/hunyuan.png'
import AzureProviderLogo from '@renderer/assets/images/models/microsoft.png'
import Ai302ProviderLogo from '@renderer/assets/images/providers/302ai.webp'
import AiHubMixProviderLogo from '@renderer/assets/images/providers/aihubmix.webp'
import AiOnlyProviderLogo from '@renderer/assets/images/providers/aiOnly.webp'
import AlayaNewProviderLogo from '@renderer/assets/images/providers/alayanew.webp'
import AnthropicProviderLogo from '@renderer/assets/images/providers/anthropic.png'
import AwsProviderLogo from '@renderer/assets/images/providers/aws-bedrock.webp'
import BaichuanProviderLogo from '@renderer/assets/images/providers/baichuan.png'
import BaiduCloudProviderLogo from '@renderer/assets/images/providers/baidu-cloud.svg'
import BailianProviderLogo from '@renderer/assets/images/providers/bailian.png'
import BurnCloudProviderLogo from '@renderer/assets/images/providers/burncloud.png'
import CephalonProviderLogo from '@renderer/assets/images/providers/cephalon.jpeg'
import CerebrasProviderLogo from '@renderer/assets/images/providers/cerebras.webp'
import CherryInProviderLogo from '@renderer/assets/images/providers/cherryin.png'
import DeepSeekProviderLogo from '@renderer/assets/images/providers/deepseek.png'
import DmxapiProviderLogo from '@renderer/assets/images/providers/DMXAPI.png'
import FireworksProviderLogo from '@renderer/assets/images/providers/fireworks.png'
import GiteeAIProviderLogo from '@renderer/assets/images/providers/gitee-ai.png'
import GithubProviderLogo from '@renderer/assets/images/providers/github.png'
import GoogleProviderLogo from '@renderer/assets/images/providers/google.png'
import GPUStackProviderLogo from '@renderer/assets/images/providers/gpustack.svg'
import GrokProviderLogo from '@renderer/assets/images/providers/grok.png'
import GroqProviderLogo from '@renderer/assets/images/providers/groq.png'
import HuggingfaceProviderLogo from '@renderer/assets/images/providers/huggingface.webp'
import HyperbolicProviderLogo from '@renderer/assets/images/providers/hyperbolic.png'
import InfiniProviderLogo from '@renderer/assets/images/providers/infini.png'
import IntelOvmsLogo from '@renderer/assets/images/providers/intel.png'
import JinaProviderLogo from '@renderer/assets/images/providers/jina.png'
import LanyunProviderLogo from '@renderer/assets/images/providers/lanyun.png'
import LMStudioProviderLogo from '@renderer/assets/images/providers/lmstudio.png'
import LongCatProviderLogo from '@renderer/assets/images/providers/longcat.png'
import MiMoProviderLogo from '@renderer/assets/images/providers/mimo.svg'
import MinimaxProviderLogo from '@renderer/assets/images/providers/minimax.png'
import MistralProviderLogo from '@renderer/assets/images/providers/mistral.png'
import ModelScopeProviderLogo from '@renderer/assets/images/providers/modelscope.png'
import MoonshotProviderLogo from '@renderer/assets/images/providers/moonshot.webp'
import NewAPIProviderLogo from '@renderer/assets/images/providers/newapi.png'
import NvidiaProviderLogo from '@renderer/assets/images/providers/nvidia.png'
import O3ProviderLogo from '@renderer/assets/images/providers/o3.png'
import OcoolAiProviderLogo from '@renderer/assets/images/providers/ocoolai.png'
import OllamaProviderLogo from '@renderer/assets/images/providers/ollama.png'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png'
import OpenRouterProviderLogo from '@renderer/assets/images/providers/openrouter.png'
import PerplexityProviderLogo from '@renderer/assets/images/providers/perplexity.png'
import Ph8ProviderLogo from '@renderer/assets/images/providers/ph8.png'
import PPIOProviderLogo from '@renderer/assets/images/providers/ppio.png'
import QiniuProviderLogo from '@renderer/assets/images/providers/qiniu.webp'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png'
import SophnetProviderLogo from '@renderer/assets/images/providers/sophnet.svg'
import StepProviderLogo from '@renderer/assets/images/providers/step.png'
import TencentCloudProviderLogo from '@renderer/assets/images/providers/tencent-cloud-ti.png'
import TogetherProviderLogo from '@renderer/assets/images/providers/together.png'
import TokenFluxProviderLogo from '@renderer/assets/images/providers/tokenflux.png'
import AIGatewayProviderLogo from '@renderer/assets/images/providers/vercel.svg'
import VertexAIProviderLogo from '@renderer/assets/images/providers/vertexai.svg'
import BytedanceProviderLogo from '@renderer/assets/images/providers/volcengine.png'
import VoyageAIProviderLogo from '@renderer/assets/images/providers/voyageai.png'
import XirangProviderLogo from '@renderer/assets/images/providers/xirang.png'
import ZaiAppLogo from '@renderer/assets/images/providers/zai.svg'
import ZeroOneProviderLogo from '@renderer/assets/images/providers/zero-one.png'
import ZhipuProviderLogo from '@renderer/assets/images/providers/zhipu.png'

export const PROVIDER_LOGO_MAP: AtLeast<SystemProviderId, string> = {
  cherryin: CherryInProviderLogo,
  ph8: Ph8ProviderLogo,
  '302ai': Ai302ProviderLogo,
  openai: OpenAiProviderLogo,
  silicon: SiliconFlowProviderLogo,
  deepseek: DeepSeekProviderLogo,
  'gitee-ai': GiteeAIProviderLogo,
  yi: ZeroOneProviderLogo,
  groq: GroqProviderLogo,
  zhipu: ZhipuProviderLogo,
  zai: ZaiAppLogo,
  ovms: IntelOvmsLogo,
  ollama: OllamaProviderLogo,
  lmstudio: LMStudioProviderLogo,
  moonshot: MoonshotProviderLogo,
  openrouter: OpenRouterProviderLogo,
  baichuan: BaichuanProviderLogo,
  dashscope: BailianProviderLogo,
  modelscope: ModelScopeProviderLogo,
  xirang: XirangProviderLogo,
  anthropic: AnthropicProviderLogo,
  aihubmix: AiHubMixProviderLogo,
  burncloud: BurnCloudProviderLogo,
  gemini: GoogleProviderLogo,
  stepfun: StepProviderLogo,
  doubao: BytedanceProviderLogo,
  minimax: MinimaxProviderLogo,
  'minimax-global': MinimaxProviderLogo,
  github: GithubProviderLogo,
  copilot: GithubProviderLogo,
  ocoolai: OcoolAiProviderLogo,
  together: TogetherProviderLogo,
  fireworks: FireworksProviderLogo,
  zhinao: ZhinaoProviderLogo,
  nvidia: NvidiaProviderLogo,
  'azure-openai': AzureProviderLogo,
  hunyuan: HunyuanProviderLogo,
  grok: GrokProviderLogo,
  hyperbolic: HyperbolicProviderLogo,
  mistral: MistralProviderLogo,
  jina: JinaProviderLogo,
  ppio: PPIOProviderLogo,
  'baidu-cloud': BaiduCloudProviderLogo,
  dmxapi: DmxapiProviderLogo,
  perplexity: PerplexityProviderLogo,
  infini: InfiniProviderLogo,
  o3: O3ProviderLogo,
  'tencent-cloud-ti': TencentCloudProviderLogo,
  gpustack: GPUStackProviderLogo,
  alayanew: AlayaNewProviderLogo,
  voyageai: VoyageAIProviderLogo,
  qiniu: QiniuProviderLogo,
  tokenflux: TokenFluxProviderLogo,
  cephalon: CephalonProviderLogo,
  lanyun: LanyunProviderLogo,
  vertexai: VertexAIProviderLogo,
  'new-api': NewAPIProviderLogo,
  'aws-bedrock': AwsProviderLogo,
  poe: 'poe', // use svg icon component
  aionly: AiOnlyProviderLogo,
  longcat: LongCatProviderLogo,
  huggingface: HuggingfaceProviderLogo,
  sophnet: SophnetProviderLogo,
  gateway: AIGatewayProviderLogo,
  cerebras: CerebrasProviderLogo,
  mimo: MiMoProviderLogo
} as const

export function getProviderLogo(providerId: string) {
  return PROVIDER_LOGO_MAP[providerId as keyof typeof PROVIDER_LOGO_MAP]
}

