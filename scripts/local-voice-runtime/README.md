# Local MLX voice runtime

Cherry distributes a pinned mlx-node TTS runtime separately from model weights. End users
only use Download in Local Models; they need neither Python nor build tools. The application
supports this artifact on macOS 26.2+ arm64. Other platforms keep existing voice providers.

## Build and package

On an Apple Silicon build host, install Xcode with its Metal Toolchain, Rust, and the
Node/Yarn versions declared by the upstream checkout. Check out mlx-node commit
`5db3d24bc87a9eb6fdb48c7ab3c9d8f126bf8d7d`, initialize its submodules, then run upstream
`yarn install --immutable`, `yarn build:native`, and `yarn build:ts`.
The MLX submodule must be `e091d678454e2462efbad8b45b87a3948bb05b38`.

Download the official `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` snapshot at
`85e237c12c027371202489a0ec509ded67b5e4b5`, preserving its speech_tokenizer directory.
Convert with the pinned native core:

```js
const { convertModel } = require('/absolute/mlx-node/packages/core/index.cjs')
await convertModel({
  inputDir: '/absolute/official-model',
  outputDir: '/absolute/converted-model',
  dtype: 'bfloat16',
  quantize: true,
  quantBits: 8,
  quantGroupSize: 64,
  quantMode: 'affine',
  modelType: 'qwen3_tts'
})
```

From the Cherry checkout:

```sh
node scripts/local-voice-runtime/build.mjs /absolute/mlx-node /absolute/converted-model /absolute/output
```

The script bundles the upstream TTS wrapper with the native binding, Metal libraries and
runtime licenses. Model files remain separate checksum-verified assets. `manifest.json`
records the exact release asset names, revisions, lengths and SHA-256 digests. The codec stays
dense; the text-to-audio weights use the audited 8-bit configuration.

## Distribution and validation

Use a dedicated non-semver runtime release, marked prerelease and never latest. Upload the
runtime archive, all model assets, manifest, the upstream Qwen Apache-2.0 license and source
revision links. Do not overwrite an existing artifact: a change needs a new release tag and
new manifest. Copy the verified manifest to
`src/main/ai/localModel/catalog/mlxNodeRelease.json` before enabling it in the catalog.

Before publication, extract the archive into a clean directory and load it without the
upstream checkout or its node_modules. Run synthesis in Cherry's actual utility process,
including non-default language/voice selection, speed, cancellation, reuse and idle release.
Verify the published bytes against the manifest, then test the app's download/install path.
Native streaming output currently becomes a finite WAV for the existing shared player;
application streaming remains tracked by #21662.
