# 本地系统语音验证实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不要求最终用户安装 Rust、ffmpeg 或任何开发工具的前提下，验证 Cherry Studio 在 macOS 26+ 使用 Apple 本地 ASR/TTS、在更早 macOS 选择已安装 FunASR，并能把共享的 WebM/Opus 录音在 Apple 适配器内部转换成 PCM/WAV。

**架构：** 新建私有工作区包 `@cherrystudio/system-speech`，浏览器入口负责 WebM/Opus 解码和 PCM/WAV 编码，Node 入口以一次一进程方式调用随应用分发的 Swift CLI。Swift CLI 只调用 `SpeechAnalyzer`、`SpeechTranscriber`、`AssetInventory` 和 `AVSpeechSynthesizer`；资源查询、显式下载、识别和合成分别使用不同命令，任何缺失资源都返回可判定错误，不触发下载或远程回退。

**技术栈：** TypeScript 7、Vitest 4、Vite、Electron 44、Swift 6 / SwiftPM、macOS Speech.framework、AVFAudio.framework、electron-builder

---

## 实施边界与仓库实践

本计划只交付技术验证，不接入设置页、输入框、播放器、偏好存储、跨窗口会话或完整的 issue 19797 产品流程。验证成功后，再以独立计划把包接入 `VoiceSessionService` 和 UI。

仓库内已有做法及本计划的应用方式：

- `packages/dsh-bridge` 和 `packages/provider-registry` 表明私有能力应放在 `packages/*`，由包自己的 `build`、`test` 脚本维护。本包也使用独立导出入口，避免浏览器入口意外打入 `node:child_process`。
- `@napi-rs/system-ocr` 表明平台能力可以延迟加载原生实现，但 Apple 的新 Speech API 是 Swift 并发 API。为这一次验证增加 Rust/N-API 会引入 Rust 工具链、Node ABI 封装和进程内崩溃面，因此采用 Swift 子进程。
- `electron-builder.yml` 已将 `resources/**/*` 放到磁盘并解包；正式接入可以沿用该布局。验证阶段使用一份继承现有配置的专用 builder 配置，避免提前修改生产打包钩子。
- 主进程路径必须通过 `application.getPath()`。本阶段的包只接收调用者注入的 helper/input/output 绝对路径；验证脚本自行创建临时目录，不在包内读取 `app.getPath()`、`os.homedir()` 或拼接 Cherry 业务目录。
- 原始 WebM 和派生 WAV 的 `FileEntry` 所有权属于后续 Voice 功能层。本包只完成字节转换与原生调用，验证代码不得直接写 SQLite 或增加 DataApi。

比较过但不采用的方案：

1. **Rust + napi-rs 包装 Swift/Objective-C：** 可以得到同步 Node API，但最终用户仍不需要 Rust，Rust 只会变成维护者和 CI 的额外构建依赖。它还把 Apple 框架故障带进 Electron 主进程，不能改善这次验证的核心问题。
2. **ffmpeg 或独立 Opus 解码器：** 可以稳定解码 WebM，但会增加二进制分发、签名和许可证面。先用 Electron 44 自身的 `AudioContext.decodeAudioData` 验证实际 `MediaRecorder` 输出；如果失败，停止本方案并单独比较解码器。
3. **`SFSpeechRecognizer` 覆盖旧 macOS：** 它不能满足“始终本地且无静默上传”的硬约束，因此旧系统直接路由到用户明确安装的 FunASR。
4. **直接修改生产 `beforePack`：** 能自动构建 helper，但会立刻影响所有平台和发布构建。验证阶段用专用打包配置完成 `.app` 冒烟；成功后再为正式集成评审生产钩子。

## 文件结构

创建或修改以下文件：

```text
packages/system-speech/
├── README.md                                  # 验证命令、显式下载说明和通过标准
├── package.json                               # 私有包、分入口构建及验证脚本
├── tsconfig.json                              # DOM + Node 类型，noEmit 类型检查
├── tsdown.config.ts                           # contracts/native/webm 三个独立入口
├── vitest.config.ts                           # 包级 Node 单测
├── src/
│   ├── contracts.ts                           # JSON 协议、结果和稳定错误码
│   ├── nativeClient.ts                        # 一次性 Swift 子进程、超时和取消
│   ├── pcm.ts                                 # 下混、重采样和 PCM16 WAV 编码
│   └── webmToWav.ts                           # Chromium 解码适配器
├── tests/
│   ├── contracts.test.ts
│   ├── nativeClient.test.ts
│   ├── pcm.test.ts
│   └── webmToWav.test.ts
├── native/
│   ├── Package.swift
│   ├── Sources/SystemSpeechHelper/
│   │   ├── AppleAsr.swift                     # Apple ASR 状态、安装和识别
│   │   ├── AppleTts.swift                     # 已安装音色和 WAV 合成
│   │   ├── Command.swift                      # Codable 请求/响应和错误
│   │   ├── SystemSpeechHelper.swift           # stdin/stdout CLI 入口
│   │   └── WavInspection.swift                # 输出 WAV 元数据读取
│   └── Tests/SystemSpeechHelperTests/
│       ├── CommandTests.swift
│       └── WavInspectionTests.swift
└── validation/
    ├── buildNative.ts                         # 构建当前架构 helper 到 dist/native
    ├── routePolicy.ts                         # Apple/FunASR 验证用纯路由
    ├── routePolicy.test.ts
    ├── run.ts                                 # capabilities/install/roundtrip/offline CLI
    ├── electron/
    │   ├── main.cjs                           # 启动隔离的 Electron 44 BrowserWindow
    │   ├── preload.cjs                        # 只暴露 fixture 读写与结果回传
    │   ├── renderer.ts                        # WAV → MediaRecorder WebM → 适配器 WAV
    │   ├── index.html
    │   └── vite.config.ts
    ├── packaging/
    │   └── electron-builder.yml               # 继承根配置的验证专用 extraResources
    └── smokePackagedHelper.ts                  # .app 内路径、签名和 capabilities 冒烟

vitest.config.ts                               # 注册 system-speech Node 测试项目
package.json                                   # 增加 test/validate 脚本并纳入 CI 测试链
pnpm-lock.yaml                                 # 工作区包依赖锁定
```

`src` 不创建 `index.ts`。`package.json#exports` 明确暴露 `./contracts`、`./native`、`./webm`，避免把三个独立运行环境伪装成一个聚合 API。

### 任务 1：建立私有工作区包和独立构建入口

**文件：**
- 创建：`packages/system-speech/package.json`
- 创建：`packages/system-speech/tsconfig.json`
- 创建：`packages/system-speech/tsdown.config.ts`
- 创建：`packages/system-speech/vitest.config.ts`
- 创建：`packages/system-speech/README.md`
- 修改：`pnpm-lock.yaml`

- [ ] **步骤 1：写出包清单**

`packages/system-speech/package.json` 使用以下完整入口和脚本：

```json
{
  "name": "@cherrystudio/system-speech",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "files": ["dist/**/*", "native/**/*"],
  "exports": {
    "./contracts": {
      "types": "./dist/contracts.d.ts",
      "import": "./dist/contracts.js"
    },
    "./native": {
      "types": "./dist/nativeClient.d.ts",
      "import": "./dist/nativeClient.js"
    },
    "./webm": {
      "types": "./dist/webmToWav.d.ts",
      "import": "./dist/webmToWav.js"
    }
  },
  "scripts": {
    "build": "tsdown",
    "build:native": "tsx validation/buildNative.ts",
    "clean": "rm -rf dist native/.build validation/electron/dist .validation-pack",
    "test": "vitest run",
    "test:native": "swift test --package-path native",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "validate": "tsx validation/run.ts",
    "validate:webm": "pnpm exec vite build --config validation/electron/vite.config.ts && electron validation/electron/main.cjs"
  },
  "devDependencies": {
    "@types/node": "^24.10.2",
    "tsdown": "^0.22.14",
    "tsx": "^4.21.0",
    "typescript": "7.0.2",
    "vite": "^8.2.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **步骤 2：写出 TypeScript、打包和测试配置**

`tsconfig.json` 继承根配置并包含 `DOM`；`tsdown.config.ts` 明确三个入口且不合并平台代码：

```json
{
  "compilerOptions": {
    "allowSyntheticDefaultImports": true,
    "declaration": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2023",
    "types": ["node", "vitest/globals"]
  },
  "exclude": ["dist", "native/.build", "validation/electron/dist"],
  "include": ["src/**/*.ts", "tests/**/*.ts", "validation/**/*.ts"]
}
```

```ts
// packages/system-speech/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/contracts.ts', 'src/nativeClient.ts', 'src/webmToWav.ts'],
  clean: true,
  dts: true,
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true
})
```

```ts
// packages/system-speech/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'validation/**/*.test.ts']
  }
})
```

- [ ] **步骤 3：安装工作区依赖并确认空包可被 pnpm 识别**

运行：

```bash
pnpm install
pnpm --filter @cherrystudio/system-speech exec tsc --version
```

预期：pnpm 识别一个工作区包，TypeScript 输出 7.x 版本；此步骤不能调用 `cargo` 或 `rustc`。

- [ ] **步骤 4：记录验证命令和硬约束**

在 `README.md` 明确写出：常规 `validate capabilities` 和 `validate roundtrip` 不下载资源；只有 `validate install-asr-assets --confirm-download` 可以下载；所有命令只接受本地路径；用户安装包不包含 Rust 工具链。

- [ ] **步骤 5：Commit**

```bash
git add packages/system-speech pnpm-lock.yaml
git commit -S --signoff -m "build(system-speech): scaffold local validation package"
```

### 任务 2：固定跨 TypeScript/Swift 的协议和旧系统路由

**文件：**
- 创建：`packages/system-speech/src/contracts.ts`
- 创建：`packages/system-speech/tests/contracts.test.ts`
- 创建：`packages/system-speech/validation/routePolicy.ts`
- 创建：`packages/system-speech/validation/routePolicy.test.ts`

- [ ] **步骤 1：先写协议和路由失败测试**

测试必须断言业务承诺，而不是复述实现：

```ts
import { describe, expect, it } from 'vitest'
import { selectAsrRoute } from '../validation/routePolicy'

describe('selectAsrRoute', () => {
  it('selects Apple only on macOS 26+ with installed assets', () => {
    expect(selectAsrRoute({ macOSMajor: 26, appleAssetStatus: 'installed', funAsrInstalled: false })).toEqual({
      kind: 'apple'
    })
  })

  it('requires an explicit Apple asset install instead of falling back', () => {
    expect(selectAsrRoute({ macOSMajor: 26, appleAssetStatus: 'supported', funAsrInstalled: true })).toEqual({
      kind: 'blocked',
      code: 'asset_required'
    })
  })

  it('uses installed FunASR before macOS 26', () => {
    expect(selectAsrRoute({ macOSMajor: 25, appleAssetStatus: 'unsupported', funAsrInstalled: true })).toEqual({
      kind: 'fun-asr'
    })
  })

  it('requires an explicit FunASR model install before macOS 26', () => {
    expect(selectAsrRoute({ macOSMajor: 25, appleAssetStatus: 'unsupported', funAsrInstalled: false })).toEqual({
      kind: 'blocked',
      code: 'model_required'
    })
  })
})
```

- [ ] **步骤 2：运行测试并确认导入失败**

运行：`pnpm --filter @cherrystudio/system-speech test -- routePolicy.test.ts`

预期：FAIL，提示 `routePolicy` 或 `selectAsrRoute` 不存在。

- [ ] **步骤 3：实现封闭路由联合类型**

```ts
// packages/system-speech/validation/routePolicy.ts
import type { AppleAssetStatus } from '../src/contracts'

export type AsrRoute =
  | { kind: 'apple' }
  | { kind: 'fun-asr' }
  | { kind: 'blocked'; code: 'asset_required' | 'model_required' | 'unsupported_locale' }

export function selectAsrRoute(input: {
  macOSMajor: number
  appleAssetStatus: AppleAssetStatus
  funAsrInstalled: boolean
}): AsrRoute {
  if (input.macOSMajor >= 26) {
    if (input.appleAssetStatus === 'installed') return { kind: 'apple' }
    if (input.appleAssetStatus === 'unsupported') return { kind: 'blocked', code: 'unsupported_locale' }
    return { kind: 'blocked', code: 'asset_required' }
  }
  return input.funAsrInstalled ? { kind: 'fun-asr' } : { kind: 'blocked', code: 'model_required' }
}
```

`contracts.ts` 定义并导出下列固定类型：

```ts
export type AppleAssetStatus = 'unsupported' | 'supported' | 'downloading' | 'installed'

export type SystemSpeechErrorCode =
  | 'unsupported_os'
  | 'unsupported_locale'
  | 'asset_required'
  | 'asset_installation_failed'
  | 'voice_unavailable'
  | 'unsupported_recording_format'
  | 'audio_decode_failed'
  | 'audio_conversion_failed'
  | 'transcription_failed'
  | 'synthesis_failed'
  | 'cancelled'
  | 'invalid_request'
  | 'native_helper_failed'

export interface InstalledVoice {
  id: string
  name: string
  locale: string
  quality: number
}

export interface CapabilitiesResult {
  osVersion: string
  requestedLocale: string
  supportedLocale: string | null
  appleAssetStatus: AppleAssetStatus
  voices: InstalledVoice[]
}

export type NativeRequest =
  | { operation: 'capabilities'; locale: string }
  | { operation: 'install_asr_assets'; locale: string; confirmDownload: true }
  | { operation: 'transcribe'; locale: string; inputPath: string }
  | { operation: 'synthesize'; voiceId: string; text: string; outputPath: string }

export type NativeSuccess =
  | { operation: 'capabilities'; result: CapabilitiesResult }
  | { operation: 'install_asr_assets'; result: { locale: string; status: 'installed' } }
  | { operation: 'transcribe'; result: { locale: string; text: string } }
  | {
      operation: 'synthesize'
      result: { voiceId: string; outputPath: string; sampleRate: number; channels: number; frameCount: number }
    }

export type NativeResponse =
  | { ok: true; value: NativeSuccess }
  | { ok: false; error: { code: SystemSpeechErrorCode; message: string } }

export class SystemSpeechError extends Error {
  constructor(
    readonly code: SystemSpeechErrorCode,
    message: string = code,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SystemSpeechError'
  }
}

export function speechError(code: SystemSpeechErrorCode, cause?: unknown): SystemSpeechError {
  return new SystemSpeechError(code, code, cause === undefined ? undefined : { cause })
}

export function isSystemSpeechError(error: unknown): error is SystemSpeechError {
  return error instanceof SystemSpeechError
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw speechError('cancelled', signal.reason)
}
```

- [ ] **步骤 4：运行包测试**

运行：`pnpm --filter @cherrystudio/system-speech test`

预期：所有协议解析和四个路由用例 PASS；类型中不存在 `remote`、`provider` 或 `SFSpeechRecognizer` 路由。

- [ ] **步骤 5：Commit**

```bash
git add packages/system-speech/src/contracts.ts packages/system-speech/tests packages/system-speech/validation
git commit -S --signoff -m "feat(system-speech): define local speech contracts"
```

### 任务 3：实现可测试的 PCM 下混、重采样和 WAV 编码

**文件：**
- 创建：`packages/system-speech/src/pcm.ts`
- 创建：`packages/system-speech/tests/pcm.test.ts`

- [ ] **步骤 1：编写能抓住声道、采样率和 WAV 头错误的测试**

```ts
import { describe, expect, it } from 'vitest'
import { downmixToMono, encodePcm16Wav, resampleLinear } from '../src/pcm'

describe('PCM conversion', () => {
  it('averages channels and clamps the result', () => {
    expect([...downmixToMono([new Float32Array([1, -1]), new Float32Array([0.5, -1])])]).toEqual([0.75, -1])
  })

  it('preserves one second when resampling 48 kHz to 16 kHz', () => {
    const output = resampleLinear(new Float32Array(48_000), 48_000, 16_000)
    expect(output).toHaveLength(16_000)
  })

  it('writes mono PCM16 WAV metadata and payload length', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 1, -1]), 16_000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
  })
})
```

- [ ] **步骤 2：运行测试并确认缺少实现**

运行：`pnpm --filter @cherrystudio/system-speech test -- pcm.test.ts`

预期：FAIL，提示 `../src/pcm` 无法解析。

- [ ] **步骤 3：实现最少的纯函数**

`pcm.ts` 导出以下签名：

```ts
export function downmixToMono(channels: readonly Float32Array[], signal?: AbortSignal): Float32Array
export function resampleLinear(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  signal?: AbortSignal
): Float32Array
export function encodePcm16Wav(samples: Float32Array, sampleRate: number, signal?: AbortSignal): Uint8Array
```

实现规则必须固定为：所有声道逐帧算术平均；每 4096 帧检查一次 `signal.aborted`；线性插值输出长度使用 `Math.round(input.length * target/source)`；PCM 使用饱和到 `[-1, 1]` 后的小端 signed 16-bit；RIFF 长度为 `36 + dataBytes`。

- [ ] **步骤 4：补充取消与非法输入测试并验证**

增加测试：声道为空、声道长度不同、采样率非正数时抛出 `audio_conversion_failed`；已取消信号抛出 `cancelled`。运行：

```bash
pnpm --filter @cherrystudio/system-speech test -- pcm.test.ts
pnpm --filter @cherrystudio/system-speech typecheck
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add packages/system-speech/src/pcm.ts packages/system-speech/tests/pcm.test.ts
git commit -S --signoff -m "feat(system-speech): encode mono PCM WAV"
```

### 任务 4：实现 WebM/Opus 浏览器适配器并用 Electron 44 生成真实输入

**文件：**
- 创建：`packages/system-speech/src/webmToWav.ts`
- 创建：`packages/system-speech/tests/webmToWav.test.ts`
- 创建：`packages/system-speech/validation/electron/main.cjs`
- 创建：`packages/system-speech/validation/electron/preload.cjs`
- 创建：`packages/system-speech/validation/electron/renderer.ts`
- 创建：`packages/system-speech/validation/electron/index.html`
- 创建：`packages/system-speech/validation/electron/vite.config.ts`

- [ ] **步骤 1：先测试格式拒绝、关闭 AudioContext 和 16 kHz 输出**

用最小 `AudioContext`/`AudioBuffer` fake 注入解码结果，断言：非 `audio/webm` 立即返回 `unsupported_recording_format`；两声道 48 kHz 解码后得到单声道 16 kHz WAV；成功和失败都调用 `close()`。

```ts
const result = await webmOpusToWav(new Blob([new Uint8Array([1])], { type: 'audio/webm;codecs=opus' }), {
  createAudioContext: () => fakeContext,
  targetSampleRate: 16_000
})
expect(result.sampleRate).toBe(16_000)
expect(result.channels).toBe(1)
expect(result.wav.subarray(0, 4)).toEqual(new TextEncoder().encode('RIFF'))
expect(fakeContext.close).toHaveBeenCalledOnce()
```

- [ ] **步骤 2：运行测试并确认缺少适配器**

运行：`pnpm --filter @cherrystudio/system-speech test -- webmToWav.test.ts`

预期：FAIL，提示 `webmToWav` 模块不存在。

- [ ] **步骤 3：实现浏览器入口**

```ts
// packages/system-speech/src/webmToWav.ts
import { isSystemSpeechError, speechError, throwIfAborted } from './contracts'
import { downmixToMono, encodePcm16Wav, resampleLinear } from './pcm'

export interface WebmToWavOptions {
  createAudioContext?: () => AudioContext
  targetSampleRate?: number
  signal?: AbortSignal
}

export interface ConvertedWav {
  wav: Uint8Array
  sampleRate: number
  channels: 1
  durationSeconds: number
}

export async function webmOpusToWav(blob: Blob, options: WebmToWavOptions = {}): Promise<ConvertedWav> {
  if (!blob.type.toLowerCase().startsWith('audio/webm')) throw speechError('unsupported_recording_format')
  const context = (options.createAudioContext ?? (() => new AudioContext()))()
  try {
    throwIfAborted(options.signal)
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    throwIfAborted(options.signal)
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    const mono = downmixToMono(channels, options.signal)
    const sampleRate = options.targetSampleRate ?? 16_000
    const samples = resampleLinear(mono, decoded.sampleRate, sampleRate, options.signal)
    return {
      wav: encodePcm16Wav(samples, sampleRate, options.signal),
      sampleRate,
      channels: 1,
      durationSeconds: samples.length / sampleRate
    }
  } catch (error) {
    if (isSystemSpeechError(error)) throw error
    throw speechError('audio_decode_failed', error)
  } finally {
    await context.close()
  }
}
```

`speechError`、`throwIfAborted` 和 `isSystemSpeechError` 放在 `contracts.ts`，错误对象只携带稳定 code 和不包含音频/文本的 message。

- [ ] **步骤 4：实现 Electron 44 真实格式验证器**

验证器使用以下固定流程：主进程从 `--source-wav` 读取 Swift TTS WAV；preload 只暴露 `readSourceWav()` 和 `report(result)`；renderer 用 `AudioContext.decodeAudioData` 解码源 WAV，把 `AudioBufferSourceNode` 接到 `MediaStreamAudioDestinationNode`，再用 `new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })` 录制。`dataavailable` 得到的真实 WebM blob 直接传给 `webmOpusToWav`，最后把 WebM、派生 WAV 和时长回传给主进程写盘。

验证器退出条件：不支持该 MIME 时退出码 2；转换异常时退出码 1；成功时 stdout 只打印一行 JSON：

```json
{"mimeType":"audio/webm;codecs=opus","sourceDuration":1.25,"derivedDuration":1.25,"sampleRate":16000,"channels":1}
```

Vite 配置把 `renderer.ts` 打入 `validation/electron/dist`；BrowserWindow 使用 `show: false`、`contextIsolation: true`、`nodeIntegration: false`，并设置 30 秒硬超时。

- [ ] **步骤 5：运行单测；真实格式检查留到 TTS helper 完成后执行**

运行：

```bash
pnpm --filter @cherrystudio/system-speech test -- pcm.test.ts webmToWav.test.ts
pnpm --filter @cherrystudio/system-speech build
```

预期：PASS，构建产物的 `webmToWav.js` 不含 `node:child_process`。

- [ ] **步骤 6：Commit**

```bash
git add packages/system-speech/src packages/system-speech/tests packages/system-speech/validation/electron
git commit -S --signoff -m "feat(system-speech): convert WebM Opus to PCM WAV"
```

### 任务 5：建立 Swift CLI 协议并实现只读 capabilities

**文件：**
- 创建：`packages/system-speech/native/Package.swift`
- 创建：`packages/system-speech/native/Sources/SystemSpeechHelper/Command.swift`
- 创建：`packages/system-speech/native/Sources/SystemSpeechHelper/SystemSpeechHelper.swift`
- 创建：`packages/system-speech/native/Sources/SystemSpeechHelper/AppleAsr.swift`
- 创建：`packages/system-speech/native/Sources/SystemSpeechHelper/AppleTts.swift`
- 创建：`packages/system-speech/native/Tests/SystemSpeechHelperTests/CommandTests.swift`
- 创建：`packages/system-speech/validation/buildNative.ts`

- [ ] **步骤 1：创建可在 macOS 13 启动、在 macOS 26 条件调用新 API 的 Swift 包**

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SystemSpeechHelper",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "cherry-system-speech", targets: ["SystemSpeechHelper"])],
    targets: [
        .executableTarget(name: "SystemSpeechHelper"),
        .testTarget(name: "SystemSpeechHelperTests", dependencies: ["SystemSpeechHelper"])
    ]
)
```

- [ ] **步骤 2：先写 JSON 解码和错误编码测试**

`CommandTests.swift` 覆盖：四种 operation 都能解码；`install_asr_assets` 缺少或传入 false 的 `confirmDownload` 返回 `invalid_request`；未知 operation 返回 `invalid_request`；错误 envelope 编码为与 TypeScript 相同的 `{ok:false,error:{code,message}}`。

- [ ] **步骤 3：运行 Swift 测试并确认失败**

运行：`xcrun swift test --package-path packages/system-speech/native`

预期：FAIL，提示 `NativeRequest`、`ResponseEnvelope` 尚未定义。

- [ ] **步骤 4：实现协议和 stdout 纪律**

`Command.swift` 使用扁平 Codable 请求：

```swift
enum Operation: String, Codable {
    case capabilities
    case installAsrAssets = "install_asr_assets"
    case transcribe
    case synthesize
}

struct NativeRequest: Decodable {
    let operation: Operation
    let locale: String?
    let confirmDownload: Bool?
    let inputPath: String?
    let voiceId: String?
    let text: String?
    let outputPath: String?
}

enum ErrorCode: String, Encodable {
    case unsupportedOs = "unsupported_os"
    case unsupportedLocale = "unsupported_locale"
    case assetRequired = "asset_required"
    case assetInstallationFailed = "asset_installation_failed"
    case voiceUnavailable = "voice_unavailable"
    case transcriptionFailed = "transcription_failed"
    case synthesisFailed = "synthesis_failed"
    case cancelled
    case invalidRequest = "invalid_request"
    case nativeHelperFailed = "native_helper_failed"
}
```

CLI 从 stdin 只读取一个 JSON 对象，stdout 只写一个 JSON envelope，诊断写 stderr，且 stderr 永不写入 transcript、待合成文本或音频字节。

- [ ] **步骤 5：实现无副作用 capabilities**

`AppleTts.installedVoices()` 只调用 `AVSpeechSynthesisVoice.speechVoices()` 并按 identifier 排序。`AppleAsr.capabilities(locale:)` 在 macOS 26+ 调用：

```swift
guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: locale)) else {
    return AppleAsrCapability(supportedLocale: nil, assetStatus: .unsupported)
}
let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
let status = await AssetInventory.status(forModules: [transcriber])
return AppleAsrCapability(supportedLocale: supported.identifier, assetStatus: AppleAssetStatus(status))
```

此方法禁止调用 `assetInstallationRequest`、`downloadAndInstall` 或 `reserve`。macOS 25 及以下返回 `appleAssetStatus: "unsupported"` 和实际 `osVersion`，同时仍列出 TTS 已安装音色；如果调用 Apple transcribe/install operation，则返回错误码 `unsupported_os`。

- [ ] **步骤 6：实现确定的原生构建脚本**

`buildNative.ts` 只在 darwin 执行；把 `process.arch` 映射为 `arm64-apple-macosx13.0` 或 `x86_64-apple-macosx13.0`。用同一个 `speechSwiftTriple` 变量依次调用参数数组 `['swift','build','--package-path',nativePath,'-c','release','--triple',speechSwiftTriple]` 和追加 `--show-bin-path` 的数组；复制结果到 `dist/native/darwin-${process.arch}/cherry-system-speech` 并设置 `0755`。使用 `spawnSync` 参数数组，不能拼 shell 命令。

- [ ] **步骤 7：运行测试、构建并查询能力两次**

运行：

```bash
xcrun swift test --package-path packages/system-speech/native
pnpm --filter @cherrystudio/system-speech build:native
printf '%s' '{"operation":"capabilities","locale":"zh-CN"}' | packages/system-speech/dist/native/darwin-arm64/cherry-system-speech
printf '%s' '{"operation":"capabilities","locale":"zh-CN"}' | packages/system-speech/dist/native/darwin-arm64/cherry-system-speech
```

预期：两次均返回有效 JSON，第二次 asset 状态不得因为第一次查询而改变；若架构为 x64，相应替换路径。

- [ ] **步骤 8：Commit**

```bash
git add packages/system-speech/native packages/system-speech/validation/buildNative.ts
git commit -S --signoff -m "feat(system-speech): expose Apple speech capabilities"
```

### 任务 6：把 Apple ASR 资源下载限制在显式命令

**文件：**
- 修改：`packages/system-speech/native/Sources/SystemSpeechHelper/AppleAsr.swift`
- 修改：`packages/system-speech/native/Sources/SystemSpeechHelper/SystemSpeechHelper.swift`
- 修改：`packages/system-speech/native/Tests/SystemSpeechHelperTests/CommandTests.swift`
- 修改：`packages/system-speech/validation/run.ts`

- [ ] **步骤 1：写出下载门测试**

把 `AppleAsr` 的资源操作抽成可注入的 `AssetManaging` 协议。测试用 recorder 断言：

- `capabilities` 的调用序列只有 `supportedLocale` 和 `status`；
- `transcribe` 在 `supported`/`downloading` 状态返回 `asset_required`，调用序列不含 install；
- `install_asr_assets` 只有 `confirmDownload == true` 时调用一次 `downloadAndInstall`，成功后调用 `reserve`。

- [ ] **步骤 2：运行测试并确认下载门尚未实现**

运行：`xcrun swift test --package-path packages/system-speech/native --filter CommandTests`

预期：FAIL，显式安装 operation 未处理。

- [ ] **步骤 3：实现唯一下载路径**

`installAssets(locale:confirmed:)` 的控制流固定为：验证 confirmed；解析支持 locale；若 status 已是 installed 则直接返回；否则获取 `AssetInventory.assetInstallationRequest(supporting:)`；request 为 nil 时返回 `asset_installation_failed`；调用 `downloadAndInstall()`；验证最终 status 为 installed；调用 `AssetInventory.reserve(locale:)`。任何异常都规范化为 `asset_installation_failed`。

`run.ts` 为安装建立独立子命令，并在进入 helper 前再次校验参数：

```ts
if (command === 'install-asr-assets' && !args.includes('--confirm-download')) {
  process.stderr.write('Refusing to download: pass --confirm-download after the user explicitly requested installation.\n')
  process.exitCode = 2
  return
}
```

- [ ] **步骤 4：验证普通查询不会安装**

运行：

```bash
xcrun swift test --package-path packages/system-speech/native
pnpm --filter @cherrystudio/system-speech build:native
pnpm --filter @cherrystudio/system-speech validate -- capabilities --locale zh-CN
pnpm --filter @cherrystudio/system-speech validate -- install-asr-assets --locale zh-CN
```

预期：测试 PASS；capabilities 只报告状态；没有 `--confirm-download` 的安装命令退出码为 2 且 helper 未启动。

- [ ] **步骤 5：在用户执行阶段设置人工检查点**

只有用户再次明确要求下载时才运行：

```bash
pnpm --filter @cherrystudio/system-speech validate -- install-asr-assets --locale zh-CN --confirm-download
```

预期：Apple 系统资源安装完成后返回 `installed`。执行计划的代理不得把设计批准或计划执行批准解释为这一次下载批准。

- [ ] **步骤 6：Commit**

```bash
git add packages/system-speech/native packages/system-speech/validation/run.ts
git commit -S --signoff -m "feat(system-speech): gate Apple ASR asset installation"
```

### 任务 7：使用已安装系统音色合成本地 WAV

**文件：**
- 修改：`packages/system-speech/native/Sources/SystemSpeechHelper/AppleTts.swift`
- 创建：`packages/system-speech/native/Sources/SystemSpeechHelper/WavInspection.swift`
- 创建：`packages/system-speech/native/Tests/SystemSpeechHelperTests/WavInspectionTests.swift`
- 修改：`packages/system-speech/native/Sources/SystemSpeechHelper/SystemSpeechHelper.swift`

- [ ] **步骤 1：写 WAV 完整性测试**

用仓库内生成的 44-byte WAV fixture 测试 `inspectWav` 会返回 sample rate、channels、frame count；截断 RIFF、非 PCM 和 data 长度越界分别失败。该测试能捕获只写 PCM buffer 却没封装完整 WAV 的实现错误。

- [ ] **步骤 2：运行测试并确认失败**

运行：`xcrun swift test --package-path packages/system-speech/native --filter WavInspectionTests`

预期：FAIL，`inspectWav` 未定义。

- [ ] **步骤 3：实现精确音色选择和 WAV 写入**

`AppleTts.synthesize` 必须先执行：

```swift
guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.identifier == voiceId }) else {
    throw HelperError(code: .voiceUnavailable, message: "Requested installed voice is unavailable")
}
```

随后创建 `AVSpeechUtterance(string: text)`，设置 `utterance.voice = voice`，调用 `AVSpeechSynthesizer.write(_:toBufferCallback:)`。第一个非空 `AVAudioPCMBuffer` 的 format 用于创建 `AVAudioFile(forWriting: URL(fileURLWithPath: outputPath), settings: format.settings)`；后续 buffer 必须保持相同 format 并写入同一文件；零长度 buffer 完成 continuation；回调错误删除半成品输出并返回 `synthesis_failed`。禁止自动选择另一个音色，禁止调用 `speak()`。

- [ ] **步骤 4：运行 Swift 测试和真实 TTS**

先从 capabilities 返回的已安装列表中显式选取第一项，保存它的精确 identifier，再构造 JSON 请求：

```bash
xcrun swift test --package-path packages/system-speech/native
pnpm --filter @cherrystudio/system-speech build:native
speech_capabilities_json="$(printf '%s' '{"operation":"capabilities","locale":"zh-CN"}' | packages/system-speech/dist/native/darwin-arm64/cherry-system-speech)"
speech_voice_id="$(printf '%s' "$speech_capabilities_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).value.result.voices.find(v=>/^zh([-_]|$)/i.test(v.locale))?.id??""))')"
test -n "$speech_voice_id"
SPEECH_VOICE_ID="$speech_voice_id" node -e 'process.stdout.write(JSON.stringify({operation:"synthesize",voiceId:process.env.SPEECH_VOICE_ID,text:"你好，Cherry Studio。",outputPath:"/tmp/cherry-system-speech-tts.wav"}))' | packages/system-speech/dist/native/darwin-arm64/cherry-system-speech
file /tmp/cherry-system-speech-tts.wav
```

预期：helper 返回 frameCount > 0；`file` 报告 RIFF/WAVE PCM。这里选择的是 capabilities 明确返回的已安装中文音色；没有中文音色时 `test -n` 失败并停止，不执行下载，也不替换成其他 locale。再传 `com.cherrystudio.validation.missing-voice`，预期 `voice_unavailable` 且不产生文件。

- [ ] **步骤 5：用真实 TTS WAV 执行 Electron WebM/Opus 验证**

运行：

```bash
pnpm --filter @cherrystudio/system-speech validate:webm -- --source-wav /tmp/cherry-system-speech-tts.wav --webm /tmp/cherry-system-speech.webm --wav /tmp/cherry-system-speech-derived.wav
file /tmp/cherry-system-speech.webm /tmp/cherry-system-speech-derived.wav
```

预期：Electron 报告 MIME `audio/webm;codecs=opus`；派生 WAV 为 mono/16 kHz；源和派生时长误差小于 100 ms。

- [ ] **步骤 6：Commit**

```bash
git add packages/system-speech/native
git commit -S --signoff -m "feat(system-speech): synthesize installed Apple voices"
```

### 任务 8：使用 SpeechAnalyzer 识别派生 WAV

**文件：**
- 修改：`packages/system-speech/native/Sources/SystemSpeechHelper/AppleAsr.swift`
- 修改：`packages/system-speech/native/Sources/SystemSpeechHelper/SystemSpeechHelper.swift`
- 修改：`packages/system-speech/native/Tests/SystemSpeechHelperTests/CommandTests.swift`

- [ ] **步骤 1：写无资源自动安装和路径校验测试**

测试注入 `supported` 状态时，`transcribe` 必须返回 `asset_required`，asset manager 的 install 计数保持 0。空 inputPath、相对路径、不存在文件分别返回 `invalid_request` 或 `transcription_failed`，且不会启动 analyzer。

- [ ] **步骤 2：运行测试并确认失败**

运行：`xcrun swift test --package-path packages/system-speech/native --filter CommandTests`

预期：FAIL，transcribe 尚未完成。

- [ ] **步骤 3：实现仅使用已安装资产的识别**

在 macOS 26 availability 块内执行以下固定顺序：

1. 通过 `SpeechTranscriber.supportedLocale(equivalentTo:)` 解析 locale；
2. 构造 `SpeechTranscriber(locale:preset:.transcription)`；
3. 查询 `AssetInventory.status(forModules:)`，非 `.installed` 立即返回 `asset_required`；
4. 用 `AVAudioFile(forReading:)` 打开调用者提供的 WAV；
5. 创建 `SpeechAnalyzer(modules: [transcriber])`；
6. 并发消费 `transcriber.results`，只拼接 `result.isFinal` 的 `String(result.text.characters)`；
7. `analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)` 完成后等待 results task；
8. 空结果返回 `transcription_failed`，否则返回 locale 与文本。

取消时调用 `await analyzer.cancelAndFinishNow()`，再向上返回 `cancelled`。本文件禁止导入或引用 `SFSpeechRecognizer`、`URLSession`、`Network`。

CLI 使用 `CancellationCoordinator` actor 保存当前 analyzer。`SystemSpeechHelper.swift` 通过 `signal(SIGTERM, SIG_IGN)` 和 `DispatchSource.makeSignalSource(signal: SIGTERM)` 接收 Node 发出的第一次终止信号；handler 调用 `operationTask.cancel()` 和 `await coordinator.cancelCurrentAnalyzer()`。helper 在宽限期内输出 `cancelled` envelope 并退出；只有未退出时 Node 才发送 `SIGKILL`。

- [ ] **步骤 4：运行测试和真实派生 WAV 识别**

前置条件是任务 6 已由用户明确安装所选 locale 的资产。运行：

```bash
xcrun swift test --package-path packages/system-speech/native
pnpm --filter @cherrystudio/system-speech build:native
printf '%s' '{"operation":"transcribe","locale":"zh-CN","inputPath":"/tmp/cherry-system-speech-derived.wav"}' | packages/system-speech/dist/native/darwin-arm64/cherry-system-speech
```

预期：返回非空 text；如果资产尚未安装，返回 `asset_required` 并停止，不执行安装。

- [ ] **步骤 5：静态检查本地边界**

运行：

```bash
if rg -n 'SFSpeechRecognizer|URLSession|NWConnection|Network.framework' packages/system-speech/src packages/system-speech/native; then exit 1; fi
if find packages/system-speech -name Cargo.toml -o -name build.rs | grep -q .; then exit 1; fi
```

预期：两个检查均退出 0 且无匹配。

- [ ] **步骤 6：Commit**

```bash
git add packages/system-speech/native
git commit -S --signoff -m "feat(system-speech): transcribe with Apple SpeechAnalyzer"
```

### 任务 9：实现 Node 子进程客户端、取消和错误规范化

**文件：**
- 创建：`packages/system-speech/src/nativeClient.ts`
- 创建：`packages/system-speech/tests/nativeClient.test.ts`

- [ ] **步骤 1：编写能抓住进程协议错误的测试**

通过注入 `spawn` fake 测试：成功 JSON 被解析；非零退出映射 `native_helper_failed`；无效 JSON 映射 `native_helper_failed`；stdout 超过 1 MiB 时终止；AbortSignal 先发 `SIGTERM`，短宽限期后才发 `SIGKILL`；中止结果是 `cancelled`；stderr 不进入成功结果。

- [ ] **步骤 2：运行测试并确认失败**

运行：`pnpm --filter @cherrystudio/system-speech test -- nativeClient.test.ts`

预期：FAIL，`SystemSpeechNativeClient` 不存在。

- [ ] **步骤 3：实现单请求客户端**

公开 API 固定为：

```ts
export interface SystemSpeechNativeClientOptions {
  helperPath: string
  timeoutMs?: number
  killGraceMs?: number
  launcher?: { executable: string; args: readonly string[] }
}

export class SystemSpeechNativeClient {
  constructor(options: SystemSpeechNativeClientOptions)
  request(request: NativeRequest, options?: { signal?: AbortSignal }): Promise<NativeSuccess>
}
```

实现必须在 spawn 前用 `stat` 验证 regular file 和 owner executable bit。没有 launcher 时使用 `spawn(helperPath, [], { stdio: ['pipe','pipe','pipe'] })`；有 launcher 时使用 `spawn(launcher.executable, [...launcher.args, helperPath], ...)`，它只用于验证时套入 `/usr/bin/sandbox-exec`。stdin 写一份 JSON 后结束；默认超时 120 秒；安装命令允许由调用者显式传更长超时；只接受一份 `NativeResponse`；失败消息截断到 4 KiB；不得记录 request，因为它可能含 transcript 或 synthesis text。

- [ ] **步骤 4：验证测试、类型和三个导出入口**

运行：

```bash
pnpm --filter @cherrystudio/system-speech test
pnpm --filter @cherrystudio/system-speech typecheck
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech exec node -e "Promise.all([import('./dist/contracts.js'),import('./dist/nativeClient.js')]).then(() => console.log('ok'))"
```

预期：PASS 并打印 `ok`。

- [ ] **步骤 5：Commit**

```bash
git add packages/system-speech/src/nativeClient.ts packages/system-speech/tests/nativeClient.test.ts
git commit -S --signoff -m "feat(system-speech): invoke native helper safely"
```

### 任务 10：完成端到端验证 CLI 和断网运行

**文件：**
- 修改：`packages/system-speech/validation/run.ts`
- 修改：`packages/system-speech/README.md`

- [ ] **步骤 1：实现严格参数解析**

`run.ts` 支持且只支持：

```text
capabilities --locale <locale>
install-asr-assets --locale <locale> --confirm-download
roundtrip --locale <locale> --voice-id <installed-id> --text <text>
offline --locale <locale> --voice-id <installed-id> --text <text>
```

`capabilities` 向 stdout 写一份扁平的 `CapabilitiesResult` JSON，方便人工检查和脚本选择已安装音色。`roundtrip` 在 `mkdtemp` 目录中按顺序执行 TTS WAV、Electron MediaRecorder WebM、TypeScript 派生 WAV、Apple ASR；成功结果只打印 locale、voiceId、格式、时长和 `transcriptNonEmpty: true`，不打印 transcript 或输入 text；finally 递归删除临时目录。

- [ ] **步骤 2：实现断网命令**

`offline` 先调用 capabilities 并要求 asset status 为 installed；随后给 `SystemSpeechNativeClient` 传入下面的 launcher，使 `synthesize` 和 `transcribe` 两次 helper 调用都经过系统网络沙箱：

```ts
const launcher = {
  executable: '/usr/bin/sandbox-exec',
  args: ['-p', '(version 1) (allow default) (deny network*)']
} as const
```

通过 `spawn` 参数数组传递 profile，不使用 shell。WebM 转换继续在 Electron renderer 内完成；其源码没有网络 API。若 `sandbox-exec` 缺失，命令返回明确的验证失败，不把普通在线运行当作通过。

- [ ] **步骤 3：运行不下载资源的能力检查**

运行：

```bash
pnpm --filter @cherrystudio/system-speech build
pnpm --filter @cherrystudio/system-speech build:native
pnpm --filter @cherrystudio/system-speech validate -- capabilities --locale zh-CN
```

预期：返回真实 locale、asset status 和 installed voices；不出现下载进度。

- [ ] **步骤 4：在资产已由用户显式安装后运行 roundtrip 和 offline**

从 capabilities 原样读取一个已安装 voice id，运行：

```bash
speech_capabilities_json="$(pnpm --silent --filter @cherrystudio/system-speech validate -- capabilities --locale zh-CN)"
speech_voice_id="$(printf '%s' "$speech_capabilities_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).voices.find(v=>/^zh([-_]|$)/i.test(v.locale))?.id??""))')"
test -n "$speech_voice_id"
pnpm --filter @cherrystudio/system-speech validate -- roundtrip --locale zh-CN --voice-id "$speech_voice_id" --text '你好，Cherry Studio。'
pnpm --filter @cherrystudio/system-speech validate -- offline --locale zh-CN --voice-id "$speech_voice_id" --text '你好，Cherry Studio。'
```

预期：两条命令均报告 WebM/Opus、mono 16 kHz WAV、非空识别结果；offline 明确报告 `networkDenied: true`。

- [ ] **步骤 5：验证取消清理**

在 runner 增加 `--abort-after-ms 1` 验证参数，仅用于测试。运行 roundtrip 后预期返回 `cancelled`，临时目录不存在，派生 WAV 未保留。该参数不加入包的生产导出。

- [ ] **步骤 6：Commit**

```bash
git add packages/system-speech/validation/run.ts packages/system-speech/README.md
git commit -S --signoff -m "test(system-speech): validate local speech round trip"
```

### 任务 11：验证 `.app` 内 helper 的位置、可执行位和签名

**文件：**
- 创建：`packages/system-speech/validation/packaging/electron-builder.yml`
- 创建：`packages/system-speech/validation/smokePackagedHelper.ts`
- 修改：`packages/system-speech/package.json`

- [ ] **步骤 1：创建只用于验证的 builder 配置**

```yaml
extends: ../../../../electron-builder.yml
directories:
  output: packages/system-speech/.validation-pack
mac:
  extraResources:
    - from: packages/system-speech/dist/native/darwin-${arch}/cherry-system-speech
      to: system-speech/cherry-system-speech
```

此文件不修改根 `beforePack`，也不改变 Linux/Windows 生产构建。

- [ ] **步骤 2：实现包内冒烟脚本**

`smokePackagedHelper.ts` 接收 `.app` 路径，使用 `path.join(appPath, 'Contents', 'Resources', 'system-speech', 'cherry-system-speech')` 解析 helper，依次验证：regular file、owner executable、以参数数组运行 `codesign --verify --deep --strict appPath`、以参数数组运行 `codesign --verify --strict helperPath`，最后向 helper 发送 capabilities JSON 并断言退出码 0 和有效 response。它不得自行安装资源。

- [ ] **步骤 3：构建 unpacked arm64 应用**

运行：

```bash
pnpm build
pnpm --filter @cherrystudio/system-speech build:native
pnpm exec electron-builder --dir --mac arm64 --config packages/system-speech/validation/packaging/electron-builder.yml
```

预期：生成 `packages/system-speech/.validation-pack/mac-arm64/Cherry Studio.app`，helper 位于预期 Resources 路径。

- [ ] **步骤 4：运行打包冒烟**

运行：

```bash
pnpm --filter @cherrystudio/system-speech exec tsx validation/smokePackagedHelper.ts '.validation-pack/mac-arm64/Cherry Studio.app'
```

预期：输出 `{\"executable\":true,\"signed\":true,\"capabilities\":true}`。若本地开发签名只支持 ad-hoc，记录实际 authority，但两个 `codesign --verify` 仍必须通过。

- [ ] **步骤 5：Commit**

```bash
git add packages/system-speech/validation packages/system-speech/package.json
git commit -S --signoff -m "test(system-speech): smoke test packaged helper"
```

### 任务 12：接入仓库测试门并完成验证记录

**文件：**
- 修改：`vitest.config.ts`
- 修改：`package.json`
- 修改：`packages/system-speech/README.md`

- [ ] **步骤 1：先证明根测试尚未发现包测试**

运行：`pnpm exec vitest list --project system-speech`

预期：FAIL，提示未知 project。

- [ ] **步骤 2：注册包测试项目**

在根 `vitest.config.ts` 的 projects 中增加：

```ts
{
  extends: 'packages/system-speech/vitest.config.ts',
  test: {
    name: 'system-speech',
    environment: 'node',
    include: [
      'packages/system-speech/tests/**/*.test.ts',
      'packages/system-speech/validation/**/*.test.ts'
    ]
  }
}
```

在根 `package.json` 增加：

```json
"test:system-speech": "vitest run --project system-speech"
```

把现有 `test` 脚本末尾改为 `--project preload --project system-speech`，把现有 `ci:test-check` 脚本末尾改为 `&& pnpm test:system-speech`。把现有 `typecheck` 的 concurrently 名称和命令分别追加 `system-speech` 与 `pnpm --filter @cherrystudio/system-speech typecheck`，使 `pnpm lint` 和 CI 类型检查覆盖新包。Swift 和真实 macOS 验证不加入跨平台默认 CI；README 明确列出 macOS 发布前命令。

- [ ] **步骤 3：运行针对性验证**

运行：

```bash
pnpm test:system-speech
pnpm --filter @cherrystudio/system-speech test:native
pnpm --filter @cherrystudio/system-speech typecheck
pnpm docs:check
pnpm lint
```

预期：全部 PASS。此变更增加工作区包、根测试配置和打包验证，属于多处构建接线，因此运行完整 `pnpm lint`；无需运行全仓 `pnpm test`，因为新增项目已通过 `test:system-speech`，其他项目没有行为变更。

- [ ] **步骤 4：记录可复核的本机事实**

在 `README.md` 的 validation evidence 表中记录日期、macOS 版本、架构、Electron 版本、Swift 版本、locale、asset 初始/最终状态、WebM MIME、WAV sample rate/channels、时长误差、offline 结果和 packaged helper 结果。不得记录 transcript、合成文本、绝对用户目录或音频文件。

同时运行：

```bash
if command -v rustc >/dev/null; then rustc --version; else echo 'rustc absent'; fi
git status --short
```

预期：即使输出 `rustc absent`，所有验证仍通过；工作树只含计划内文件。

- [ ] **步骤 5：检查提交签名和 DCO**

运行：

```bash
git log --format='%h %G? %s%n%b' -- packages/system-speech vitest.config.ts package.json | head -120
```

预期：本计划产生的每个提交 `%G?` 为 `G`，正文包含 `Signed-off-by:`。

- [ ] **步骤 6：Commit**

```bash
git add vitest.config.ts package.json packages/system-speech/README.md
git commit -S --signoff -m "test(system-speech): add validation gates"
```

## 完成标准

只有下列事实全部成立，才能把验证标记为成功：

- 当前 macOS 26.x arm64 主机在没有 Rust 和 ffmpeg 的情况下构建并运行 helper。
- capabilities 查询不改变资产状态；缺少资产时 transcribe 返回 `asset_required`。
- 只有用户明确执行带 `--confirm-download` 的命令才安装 Apple ASR 资产。
- 指定的已安装音色生成非空、完整、浏览器可解码的 WAV；不存在的音色不被替换。
- Electron 44 的真实 `MediaRecorder` WebM/Opus 被适配器转换成 mono/16 kHz PCM WAV，时长误差小于 100 ms。
- Apple SpeechAnalyzer 对派生 WAV 返回非空文本。
- helper 在 `sandbox-exec` 禁止网络时仍完成 TTS 和已就绪 ASR。
- 取消会终止子进程并删除派生文件。
- 路由测试在 macOS 26+ 选择 Apple，在更早版本只选择已安装 FunASR，类型中没有远程或 `SFSpeechRecognizer` 分支。
- unpacked `.app` 内 helper 位于 `Contents/Resources/system-speech/cherry-system-speech`，具有可执行位，签名验证通过并能运行 capabilities。

Intel macOS 和真实 macOS 25 机器上的打包运行不在当前主机可证明的范围内。它们是正式宣称全平台支持前的发布门，不影响本次 arm64/macOS 26 技术验证结论。
