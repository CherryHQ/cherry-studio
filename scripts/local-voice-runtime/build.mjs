import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

import { create } from 'tar'
import { build } from 'vite'

const sourceRevision = '5db3d24bc87a9eb6fdb48c7ab3c9d8f126bf8d7d'
const modelRevision = '85e237c12c027371202489a0ec509ded67b5e4b5'
const tag = `mlx-node-${sourceRevision.slice(0, 12)}-r1`
const [sourceArg, modelArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !modelArg || !outputArg)
  throw new Error('Usage: node build.mjs <mlx-node checkout> <converted model> <output>')
const source = resolve(sourceArg)
const model = resolve(modelArg)
const output = resolve(outputArg)
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== sourceRevision)
  throw new Error('Source revision does not match the audited runtime')
if (execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim())
  throw new Error('Build from a clean pinned checkout')
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(source, 'crates/mlx-sys/mlx'), encoding: 'utf8' }).trim() !==
  'e091d678454e2462efbad8b45b87a3948bb05b38'
)
  throw new Error('MLX submodule revision does not match the audited runtime')
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build on Apple Silicon')
const config = JSON.parse(await readFile(join(model, 'config.json'), 'utf8'))
if (
  config.model_type !== 'qwen3_tts' ||
  config.mlx_node_tts_format !== 1 ||
  config.quantization?.bits !== 8 ||
  config.quantization?.group_size !== 64 ||
  config.quantization?.mode !== 'affine'
)
  throw new Error('Expected the audited Qwen3-TTS 8-bit conversion')
const runtime = join(output, 'runtime')
await mkdir(runtime, { recursive: true })
await writeFile(join(runtime, 'native.cjs'), "module.exports = require('cherry-mlx-native')\n")
await build({
  configFile: false,
  plugins: [
    {
      name: 'mlx-runtime-binding',
      enforce: 'pre',
      resolveId(id) {
        if (id === '@mlx-node/core' || id.endsWith('/core/index.cjs')) return join(runtime, 'native.cjs')
      }
    }
  ],
  build: {
    outDir: runtime,
    emptyOutDir: false,
    minify: false,
    lib: { entry: join(source, 'packages/tts/dist/index.js'), formats: ['cjs'], fileName: () => 'runtime.cjs' },
    rolldownOptions: {
      external: (id) => id.startsWith('node:') || id === 'cherry-mlx-native',
      output: { codeSplitting: false, paths: { 'cherry-mlx-native': './mlx-core.darwin-arm64.node' } }
    }
  }
})
const supportFiles = ['mlx-core.darwin-arm64.node', 'mlx.metallib', 'paged_attn.metallib', 'LICENSE', 'MLX-LICENSE']
for (const name of supportFiles.slice(0, 3)) await copyFile(join(source, 'packages/core', name), join(runtime, name))
await copyFile(join(source, 'LICENSE'), join(runtime, 'LICENSE'))
await copyFile(join(source, 'crates/mlx-sys/mlx/LICENSE'), join(runtime, 'MLX-LICENSE'))
const archive = 'mlx-node-darwin-arm64.tgz'
await create({ cwd: output, file: join(output, archive), gzip: true, portable: true, mtime: new Date(0) }, [
  'runtime/runtime.cjs',
  ...supportFiles.map((name) => `runtime/${name}`)
])
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
const files = []
const paths = [
  'config.json',
  'generation_config.json',
  'merges.txt',
  'model.safetensors',
  'preprocessor_config.json',
  'tokenizer_config.json',
  'vocab.json',
  'speech_tokenizer/config.json',
  'speech_tokenizer/configuration.json',
  'speech_tokenizer/model.safetensors',
  'speech_tokenizer/preprocessor_config.json'
]
for (const relPath of paths) {
  const asset = `qwen3-tts-0.6b-customvoice-8bit--${relPath.replaceAll('/', '--')}`
  await copyFile(join(model, relPath), join(output, asset))
  const bytes = await readFile(join(output, asset))
  files.push({ relPath, asset, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const manifest = {
  repository: 'CherryHQ/cherry-studio',
  tag,
  sourceRevision,
  modelRevision,
  runtime: { asset: archive, sha256: await digest(join(output, archive)), entryFile: 'runtime.cjs', supportFiles },
  model: { id: 'qwen3-tts-0.6b-customvoice-8bit', files }
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
process.stdout.write(`Artifacts and manifest: ${output}\n`)
