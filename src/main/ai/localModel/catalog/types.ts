import type { PathKey } from '@main/core/paths/pathRegistry'
import type { LocalModelBundleId, LocalModelCapability } from '@shared/data/presets/localModel'

/**
 * Vocabulary of the local-model catalog: *what* can be installed, *where* its
 * bytes come from, and *whether* they are on disk right now. Data shapes only —
 * fetching lives in `../acquisition`, state in `../installation/LocalModelStorageService`.
 */

/** `${process.platform}-${process.arch}`, e.g. `darwin-arm64`. */
export type PlatformKey = string

export function currentPlatformKey(): PlatformKey {
  return `${process.platform}-${process.arch}`
}

/**
 * A native runtime shipped as an npm package, shared by every bundle that declares it
 * in {@link ModelBundle.requires} — today onnxruntime-node, later a second inference
 * runtime. Fetched as the whole npm tarball and verified as a whole, so the extracted
 * platform files need no checksum of their own.
 */
export interface SharedArtifact {
  id: SharedArtifactId
  packageName: string
  version: string
  /** sha256 of the whole npm tarball. Regenerate with:
   * `curl -sL <registry>/<pkg>/-/<pkg>-<version>.tgz | shasum -a 256` */
  tarballSha256: string
  installDirKey: PathKey
  /** Platforms this artifact ships binaries for. A missing entry means *unsupported*:
   * every bundle requiring it reads as `unsupported` there rather than offering a
   * download that could only fail (today darwin-x64, which onnxruntime-node skips). */
  platforms: Partial<Record<PlatformKey, ArtifactPlatformFiles>>
}

export type SharedArtifactId = 'onnxruntime-node'

/** The files one platform needs, and where they sit inside the tarball. */
export interface ArtifactPlatformFiles {
  /** Tarball path prefix holding this platform's files, e.g. `package/bin/napi-v6/darwin/arm64/`.
   * Entries are flattened onto the install dir, so its depth is also the strip count. */
  tarballPrefix: string
  /** Where the flattened files land, relative to {@link SharedArtifact.installDirKey}.
   * Spelled out rather than derived from {@link tarballPrefix} because it is a layout
   * users already have on disk — changing it would silently orphan every install. */
  installSubdir: string
  /** The file consumers address the artifact by (the loadable native binding). */
  entryFile: string
  /** Everything else that must sit beside {@link entryFile} for it to load. */
  supportFiles: string[]
}

/** A file's bytes are transformed before they land on disk. */
export type BundleFileDerivation = 'paddle_dict_from_inference_yml'

/**
 * One file of a bundle. `sha256` covers the bytes as *fetched*; when a
 * {@link derivation} rewrites them, what lands at {@link relPath} is the derived
 * output, so {@link minBytes} — the disk-scan floor — describes that instead.
 */
export interface BundleFile {
  /** Stable name for addressing one file of a bundle (`detection`, `dictionary`, …). */
  key: string
  /** Where it lands, relative to the bundle's install dir. May nest (`onnx/model.onnx`). */
  relPath: string
  /** HuggingFace / ModelScope repo id, resolved against a mirror at download time. */
  repo: string
  /** Filename within the repo. */
  remoteFile: string
  /** sha256 of the fetched bytes, verified while streaming. Mandatory: it is the only
   * thing standing between a truncated response / LFS pointer / captive-portal page and
   * the model dir, and it is what lets a bad mirror fall through to the next one. */
  sha256: string
  /** Disk-scan floor for the installed file — enough to catch a truncated leftover from
   * a pre-checksum install without forcing a re-download when upstream bumps a revision. */
  minBytes: number
  /** Share of the bundle's progress bar (≈ file MB). */
  weight: number
  derivation?: BundleFileDerivation
}

/**
 * The unit users install, and the catalog's first-class citizen: one capability's
 * files fetched, verified, reported and removed together. A capability rarely maps to
 * a single file — OCR already needs detection + recognition + dictionary.
 */
export interface ModelBundle {
  id: LocalModelBundleId
  capability: LocalModelCapability
  /** Install root; every {@link BundleFile.relPath} resolves under it. */
  installDirKey: PathKey
  /** Subdirectory of the install root the files actually live in. Present only where a
   * loader dictates the layout — transformers.js resolves a model relative to the
   * directory holding its `config.json`, and that directory is named after the repo. */
  installSubdir?: string
  /** A subdirectory an earlier release installed this bundle into. Still accepted so an
   * upgrade never re-downloads, and lifted into {@link installSubdir} opportunistically.
   * Removable once the upgrade window has passed. */
  legacyInstallSubdir?: string
  files: BundleFile[]
  /** Shared runtimes this bundle cannot run without. Also the removal-GC input: a shared
   * artifact outlives a bundle exactly as long as another installed bundle requires it. */
  requires: SharedArtifactId[]
  /** Metadata inference needs but acquisition does not. `dtype` is the transformers.js
   * quantization selector, which must match the weights file the bundle actually installs. */
  runtime?: { dtype: string }
}

/**
 * On-disk presence of a bundle. Derived from the filesystem on demand rather than
 * recorded in a database: a stored flag drifts the moment a user clears the directory,
 * and the recovery path for "DB says installed, disk disagrees" is worse than a scan.
 *
 * Scanning checks existence and {@link BundleFile.minBytes}, never sha256 — hashing
 * ~700MB of weights on every status query would trade a correct answer for an unusable one.
 * Checksums are enforced where the bytes arrive, in the download path.
 */
export type InstallState =
  | { status: 'not_installed' }
  | { status: 'incomplete'; missingFiles: string[] }
  | { status: 'installed' }
  | { status: 'unsupported' }
