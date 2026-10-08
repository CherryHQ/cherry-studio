# Computer Use SDK artifact

The SDK is not yet published on npm. Cherry installs this checked-in tarball so clean checkouts and CI do not depend on a developer's `.context` directory. Replace it with an exact registry version once published, then remove this directory and update the package installation test.

- Source: [CherryHQ/cherry-computer-use at 033bb9d6334aa26382fd66365d8e679e5e4b986d](https://github.com/CherryHQ/cherry-computer-use/tree/033bb9d6334aa26382fd66365d8e679e5e4b986d)
- Package: `@cherrystudio/computer-use@0.1.0-alpha.0`
- Artifact: `cherrystudio-computer-use-0.1.0-alpha.0-033bb9d.tgz`
- SHA-256: `f6ec62fbe2055e9b3e13affbf2521d8368724c52bb661ea5e30dba9d64ecf8f7`
- Build: Node `24.21.0`, npm `11.19.0`; exact dependencies from the source commit's `package-lock.json`.

The tarball contains bundled ESM/CJS, type declarations, the SDK README, MIT license and third-party notices. It contains no native helper. Runtime setup remains separate; see [Computer Use development](../../docs/contrib/computer-use-development.md).

To rebuild from a clean checkout of the source commit:

```sh
npm ci --ignore-scripts
npm run sdk:test
npm pack --workspace @cherrystudio/computer-use --ignore-scripts
mv cherrystudio-computer-use-0.1.0-alpha.0.tgz cherrystudio-computer-use-0.1.0-alpha.0-033bb9d.tgz
```

When updating the artifact, record its source commit and checksum here, regenerate `pnpm-lock.yaml`, and run `pnpm test:scripts scripts/__tests__/computer-use-packaging.test.ts` plus the affected checks. Do not pack an uncommitted SDK checkout.
