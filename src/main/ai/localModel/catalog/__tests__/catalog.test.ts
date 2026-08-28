import {
  LOCAL_MODEL_BUNDLE_BY_CAPABILITY,
  LOCAL_MODEL_BUNDLE_IDS,
  LOCAL_MODEL_CAPABILITIES
} from '@shared/data/presets/localModel'
import { describe, expect, it } from 'vitest'

import {
  ALL_MODEL_BUNDLE_IDS,
  bundleDtype,
  bundleFile,
  bundleForCapability,
  LOCAL_MODEL_BUNDLES,
  SHARED_ARTIFACTS
} from '../catalog'

const bundles = Object.values(LOCAL_MODEL_BUNDLES)
const artifacts = Object.values(SHARED_ARTIFACTS)

/**
 * Guards on the catalog itself — the checks that catch a model added by hand with a
 * field missed. Everything downstream (download, verification, scanning, removal) reads
 * these entries, so a typo here fails at download time on a user's machine instead.
 */
describe('local model catalog', () => {
  it.each(bundles)('$id declares a verifiable checksum for every file', (bundle) => {
    for (const file of bundle.files) {
      // A file without a real digest would download unverified — the one thing the
      // acquisition layer must never allow.
      expect(file.sha256, `${bundle.id}/${file.key} has no sha256`).toMatch(/^[0-9a-f]{64}$/)
      expect(file.minBytes, `${bundle.id}/${file.key} has no size floor`).toBeGreaterThan(0)
    }
  })

  it.each(bundles)('$id addresses each file by a unique key and path', (bundle) => {
    const keys = bundle.files.map((file) => file.key)
    const paths = bundle.files.map((file) => file.relPath)

    // Duplicates come from copy-pasting an entry: two files would fight over one path,
    // and `bundleFile` would silently resolve only the first of a duplicated key.
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it.each(bundles)('$id requires only artifacts that exist', (bundle) => {
    for (const id of bundle.requires) {
      expect(SHARED_ARTIFACTS[id], `${bundle.id} requires unknown artifact ${id}`).toBeDefined()
    }
  })

  it.each(LOCAL_MODEL_CAPABILITIES)('capability %s resolves to exactly one bundle', (capability) => {
    const matching = bundles.filter((bundle) => bundle.capability === capability)

    expect(matching).toHaveLength(1)
    expect(bundleForCapability(capability).id).toBe(matching[0].id)
  })

  it('exposes every bundle id', () => {
    expect([...ALL_MODEL_BUNDLE_IDS].sort()).toEqual(bundles.map((bundle) => bundle.id).sort())
  })

  it('agrees with the vocabulary the renderer addresses it by', () => {
    // The renderer cannot import the catalog, so `@shared` declares the ids and the
    // capability→bundle mapping separately. A bundle renamed on one side only would
    // leave every card and download entry pointing at a model that does not exist.
    expect([...LOCAL_MODEL_BUNDLE_IDS].sort()).toEqual(bundles.map((bundle) => bundle.id).sort())
    for (const [capability, id] of Object.entries(LOCAL_MODEL_BUNDLE_BY_CAPABILITY)) {
      expect(bundleForCapability(capability as (typeof LOCAL_MODEL_CAPABILITIES)[number]).id).toBe(id)
    }
  })

  it.each(artifacts)('$id ships a complete file set for each platform it supports', (artifact) => {
    for (const [platform, files] of Object.entries(artifact.platforms)) {
      expect(files.entryFile, `${artifact.id}/${platform} has no entry file`).toBeTruthy()
      expect(files.installSubdir, `${artifact.id}/${platform} has no install subdir`).toBeTruthy()
      // The entry file is installed separately from the support files; listing it twice
      // would make the install rename it after it has already been moved.
      expect(files.supportFiles).not.toContain(files.entryFile)
      // Flattening relies on the prefix ending at a directory boundary.
      expect(files.tarballPrefix.endsWith('/')).toBe(true)
      // Same reason bundle files carry one: an unverified tarball is a native binary
      // installed from whatever the mirror happened to serve.
      expect(files.tarballSha256, `${artifact.id}/${platform} has no tarball digest`).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it.each(artifacts)('$id installs each platform into its own directory', (artifact) => {
    // Platforms sharing one install dir would overwrite each other's binaries, which is
    // reachable in practice: an arm64 Mac runs the x64 build under Rosetta.
    const subdirs = Object.values(artifact.platforms).map((files) => files.installSubdir)

    expect(new Set(subdirs).size).toBe(subdirs.length)
  })

  it('ships the complete sherpa runtime on Windows x64', () => {
    expect(SHARED_ARTIFACTS['sherpa-onnx'].platforms['win32-x64']).toMatchObject({
      packageName: 'sherpa-onnx-win-x64',
      entryFile: 'sherpa-onnx.node',
      supportFiles: expect.arrayContaining([
        'onnxruntime_providers_shared.dll',
        'onnxruntime.dll',
        'sherpa-onnx-c-api.dll',
        'sherpa-onnx-cxx-api.dll'
      ])
    })
  })

  it('throws on an unknown file key rather than yielding an undefined path', () => {
    expect(() => bundleFile(bundleForCapability('ocr'), 'nope')).toThrow(/no file with key/)
  })

  it('throws when asked for a dtype the bundle does not declare', () => {
    // OCR runs through ppu-paddle-ocr, which has no transformers.js dtype; asking for one
    // means a caller confused the two runtimes.
    expect(() => bundleDtype(bundleForCapability('ocr'))).toThrow(/declares no runtime dtype/)
    expect(bundleDtype(bundleForCapability('embedding'))).toBe('q8')
  })
})
