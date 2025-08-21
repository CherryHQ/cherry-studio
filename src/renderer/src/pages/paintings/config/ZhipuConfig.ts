import { uuid } from '@renderer/utils'
import { Model } from '@renderer/types'
import { SYSTEM_MODELS } from '@renderer/config/models'

export const COURSE_URL = 'https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4'
export const TOP_UP_URL = 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/iv'

// 从主模型配置中获取智谱AI绘图模型
export const ZHIPU_PAINTING_MODELS: Model[] = SYSTEM_MODELS.zhipu.filter(model => 
  model.id === 'cogview-3-flash' || 
  model.id === 'cogview-4-250304'
)

export const DEFAULT_PAINTING = {
  id: uuid(),
  urls: [],
  files: [],
  prompt: '',
  negativePrompt: '',
  imageSize: '1024x1024',
  numImages: 1,
  seed: '',
  model: 'cogview-3-flash',
  quality: 'standard'
}

export const QUALITY_OPTIONS = [
  { label: '标准（默认）', value: 'standard' },
  { label: '高清', value: 'hd' }
]

export const IMAGE_SIZES = [
  { label: '1024x1024 (默认)', value: '1024x1024' },
  { label: '768x1344', value: '768x1344' },
  { label: '864x1152', value: '864x1152' },
  { label: '1344x768', value: '1344x768' },
  { label: '1152x864', value: '1152x864' },
  { label: '1440x720', value: '1440x720' },
  { label: '720x1440', value: '720x1440' }
]
