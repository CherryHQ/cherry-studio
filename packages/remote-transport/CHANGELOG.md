# @cherrystudio/remote-transport

## 0.2.5

### Patch Changes

- Updated dependencies [[`bc570d2`](https://github.com/CherryHQ/cherry-studio/commit/bc570d2b98f81be7922fbc1f879b8db530c5b60d)]:
  - @cherrystudio/remote-protocol@0.7.0

## 0.2.4

### Patch Changes

- [#21979](https://github.com/CherryHQ/cherry-studio/pull/21979) [`332717f`](https://github.com/CherryHQ/cherry-studio/commit/332717fa06c47f361d85039e7e9a16693ffd66b1) Thanks [@drakeo338](https://github.com/drakeo338)! - Apply backpressure when a remote socket's queued bytes reach the cap instead of aborting the stream; the stream waits for the buffer to drain and aborts only if it stays congested past the idle timeout.

## 0.2.3

### Patch Changes

- Updated dependencies [[`8bf2fe2`](https://github.com/CherryHQ/cherry-studio/commit/8bf2fe28d50170eb7b04c99dd5f8bfcf1913f2ae)]:
  - @cherrystudio/remote-protocol@0.6.0

## 0.2.2

### Patch Changes

- [#21687](https://github.com/CherryHQ/cherry-studio/pull/21687) [`0b12bae`](https://github.com/CherryHQ/cherry-studio/commit/0b12bae17ae1de88c83c96fc79cb086cb5bb2898) Thanks [@lianshuang-photo](https://github.com/lianshuang-photo)! - Add `RemoteRpcServer.refuse()` so admission control above the server can answer a request without dispatching it.

## 0.2.1

### Patch Changes

- Updated dependencies [[`755f06d`](https://github.com/CherryHQ/cherry-studio/commit/755f06d1a367aaef741e35e6e9896e1300682af5)]:
  - @cherrystudio/remote-protocol@0.5.0

## 0.2.0

### Minor Changes

- [#21399](https://github.com/CherryHQ/cherry-studio/pull/21399) [`5485d7e`](https://github.com/CherryHQ/cherry-studio/commit/5485d7ef2974c2ac193a55427f6419461cb4cbd5) Thanks [@DeJeune](https://github.com/DeJeune)! - Add negotiated, bounded Agent attachment uploads and file-only messages with opaque upload references, resumable transfers, and revisioned attachment drafts for upload-before-send.

### Patch Changes

- Updated dependencies [[`5485d7e`](https://github.com/CherryHQ/cherry-studio/commit/5485d7ef2974c2ac193a55427f6419461cb4cbd5)]:
  - @cherrystudio/remote-protocol@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`a03c8bb`](https://github.com/CherryHQ/cherry-studio/commit/a03c8bb3664e7eefe31a55d401d6bb433e5e6fec)]:
  - @cherrystudio/remote-protocol@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`2abe256`](https://github.com/CherryHQ/cherry-studio/commit/2abe256cbe3ab2da8b28262a268e0e2639fdcabe)]:
  - @cherrystudio/remote-protocol@0.2.0

## 0.1.0

### Minor Changes

- [#20717](https://github.com/CherryHQ/cherry-studio/pull/20717) [`b43fb49`](https://github.com/CherryHQ/cherry-studio/commit/b43fb49b6c345a30e0b0b3cd03885c05f3f6ef97) Thanks [@zhangjiadi225](https://github.com/zhangjiadi225)! - Publish the initial remote access packages: portable JSON-RPC and Agent recovery contracts, plus an encrypted Noise XX transport shared by desktop and mobile clients.

### Patch Changes

- Updated dependencies [[`b43fb49`](https://github.com/CherryHQ/cherry-studio/commit/b43fb49b6c345a30e0b0b3cd03885c05f3f6ef97)]:
  - @cherrystudio/remote-protocol@0.1.0
