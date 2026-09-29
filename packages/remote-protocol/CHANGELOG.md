# @cherrystudio/remote-protocol

## 0.2.0

### Minor Changes

- [#21172](https://github.com/CherryHQ/cherry-studio/pull/21172) [`2abe256`](https://github.com/CherryHQ/cherry-studio/commit/2abe256cbe3ab2da8b28262a268e0e2639fdcabe) Thanks [@zhangjiadi225](https://github.com/zhangjiadi225)! - Cache validated streaming text byte lengths so append offset checks encode only the new text after the first append, and export `textByteLength` so producers compute append offsets from the same cache. Keep wire fields, offset validation, atomic recovery, and completion digest checks unchanged.

## 0.1.0

### Minor Changes

- [#20717](https://github.com/CherryHQ/cherry-studio/pull/20717) [`b43fb49`](https://github.com/CherryHQ/cherry-studio/commit/b43fb49b6c345a30e0b0b3cd03885c05f3f6ef97) Thanks [@zhangjiadi225](https://github.com/zhangjiadi225)! - Publish the initial remote access packages: portable JSON-RPC and Agent recovery contracts, plus an encrypted Noise XX transport shared by desktop and mobile clients.
