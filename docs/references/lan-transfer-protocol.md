# Cherry Studio LAN Transfer Protocol Specification

> Version: 1.0
> Last Updated: 2025-12

This document defines the LAN file transfer protocol between the Cherry Studio desktop client (Electron) and mobile client (Expo).

---

## Table of Contents

1. [Protocol Overview](#1-protocol-overview)
2. [Service Discovery (Bonjour/mDNS)](#2-service-discovery-bonjourmdns)
3. [TCP Connection and Handshake](#3-tcp-connection-and-handshake)
4. [Message Format Specification](#4-message-format-specification)
5. [File Transfer Protocol](#5-file-transfer-protocol)
6. [Heartbeat and Keep-alive](#6-heartbeat-and-keep-alive)
7. [Error Handling](#7-error-handling)
8. [Constants and Configuration](#8-constants-and-configuration)
9. [Complete Sequence Diagram](#9-complete-sequence-diagram)
10. [Mobile Implementation Guide](#10-mobile-implementation-guide)

---

## 1. Protocol Overview

### 1.1 Architecture Roles

| Role | Platform | Responsibility |
|------|----------|---------------|
| **Client** | Electron Desktop | Scan services, initiate connections, send files |
| **Server** | Expo Mobile | Publish services, accept connections, receive files |

### 1.2 Protocol Stack (v1)

```
┌─────────────────────────────────────┐
│     Application Layer (File Transfer)│
├─────────────────────────────────────┤
│     Message Layer (Control: JSON \n) │
│                   (Data: Binary Frame)│
├─────────────────────────────────────┤
│     Transport Layer (TCP)            │
├─────────────────────────────────────┤
│     Discovery Layer (Bonjour/mDNS)   │
└─────────────────────────────────────┘
```

### 1.3 Communication Flow Overview

```
1. Service Discovery → Mobile publishes mDNS service, Desktop scans and discovers
2. TCP Handshake → Establish connection, exchange device info (version=1)
3. File Transfer → Control messages use JSON, file_chunk uses binary frame chunked transfer
4. Keep-alive → ping/pong heartbeat
```

---

## 2. Service Discovery (Bonjour/mDNS)

### 2.1 Service Type

| Property | Value |
|----------|-------|
| Service Type | `cherrystudio` |
| Protocol | `tcp` |
| Full Service ID | `_cherrystudio._tcp` |

### 2.2 Service Publishing (Mobile)

Mobile must publish the service via mDNS/Bonjour:

```typescript
{
  name: "Cherry Studio Mobile",
  type: "cherrystudio",
  protocol: "tcp",
  port: 53317,
  txt: {
    version: "1",
    platform: "ios"  // or "android"
  }
}
```

### 2.3 Service Discovery (Desktop)

Desktop scans and resolves service information:

```typescript
type LanTransferPeer = {
  id: string;
  name: string;
  host?: string;
  fqdn?: string;
  port?: number;
  type?: string;
  protocol?: 'tcp' | 'udp';
  addresses: string[];
  txt?: Record<string, string>;
  updatedAt: number;
}
```

### 2.4 IP Address Selection Strategy

When a service has multiple IP addresses, prefer IPv4:

```typescript
const preferredAddress = addresses.find((addr) => isIPv4(addr)) || addresses[0]
```

---

## 3. TCP Connection and Handshake

### 3.1 Connection Establishment

1. Client establishes TCP connection using the discovered `host:port`
2. Immediately sends a handshake message upon connection
3. Waits for server handshake acknowledgment

### 3.2 Handshake Messages (Protocol Version v1)

#### Client → Server: `handshake`

```typescript
type LanTransferHandshakeMessage = {
  type: 'handshake';
  deviceName: string;
  version: string;     // Protocol version, currently "1"
  platform?: string;   // 'darwin' | 'win32' | 'linux'
  appVersion?: string;
}
```

---

## 4. Message Format Specification (Mixed Protocol)

v1 uses a "control JSON + binary data frame" mixed protocol (streaming mode, no per-chunk ACK):

- **Control messages** (handshake, heartbeat, file_start/ack, file_end, file_complete): UTF-8 JSON, `\n` delimited
- **Data messages** (`file_chunk`): Binary frames using Magic + total length for framing, no Base64

### 4.1 Control Message Encoding (JSON + `\n`)

| Property | Specification |
|----------|--------------|
| Encoding | UTF-8 |
| Serialization | JSON |
| Message Delimiter | `\n` (0x0A) |

### 4.2 `file_chunk` Binary Frame Format

To solve TCP packet splitting/merging and eliminate Base64 overhead, `file_chunk` uses binary frames with total length:

```
┌──────────┬──────────┬────────┬───────────────┬──────────────┬────────────┬───────────┐
│ Magic    │ TotalLen │ Type   │ TransferId Len│ TransferId   │ ChunkIdx   │ Data      │
│ 0x43 0x53│ (4B BE)  │ 0x01   │ (2B BE)       │ (UTF-8)      │ (4B BE)    │ (raw)     │
└──────────┴──────────┴────────┴───────────────┴──────────────┴────────────┴───────────┘
```

| Field | Size | Description |
|-------|------|-------------|
| Magic | 2B | Constant `0x43 0x53` ("CS"), distinguishes from JSON messages |
| TotalLen | 4B | Big-endian, total frame length (excluding Magic/TotalLen) |
| Type | 1B | `0x01` for `file_chunk` |
| TransferId Len | 2B | Big-endian, transferId string length |
| TransferId | nB | UTF-8 transferId (length from previous field) |
| ChunkIdx | 4B | Big-endian, chunk index starting from 0 |
| Data | mB | Raw file binary data (unencoded) |

> Total frame length calculation: `TotalLen = 1 + 2 + transferIdLen + 4 + dataLen`

### 4.3 Message Parsing Strategy

1. Read socket data into buffer
2. If first two bytes are `0x43 0x53` → parse as binary frame
3. Else if first byte is `{` → parse as JSON + `\n` control message
4. Otherwise discard 1 byte and continue loop

### 4.4 Message Type Summary (v1)

| Type | Direction | Encoding | Purpose |
|------|-----------|----------|---------|
| `handshake` | Client → Server | JSON+\n | Handshake request (version=1) |
| `handshake_ack` | Server → Client | JSON+\n | Handshake response |
| `ping` | Client → Server | JSON+\n | Heartbeat request |
| `pong` | Server → Client | JSON+\n | Heartbeat response |
| `file_start` | Client → Server | JSON+\n | Start file transfer |
| `file_start_ack` | Server → Client | JSON+\n | File transfer acknowledgment |
| `file_chunk` | Client → Server | Binary | File data chunk (no Base64, streaming, no per-chunk ACK) |
| `file_end` | Client → Server | JSON+\n | File transfer end |
| `file_complete` | Server → Client | JSON+\n | Transfer completion result |

---

## 5. File Transfer Protocol

### 5.1 Transfer Flow

```
Client (Sender)                     Server (Receiver)
     |                                    |
     |──── 1. file_start ────────────────>|
     |                                    |
     |<─── 2. file_start_ack ─────────────|
     |                                    |
     |══════ Loop: send data chunks ══════|
     |                                    |
     |──── 3. file_chunk [0] ────────────>|
     |──── 3. file_chunk [1] ────────────>|
     |      ... repeat until all sent ... |
     |                                    |
     |──── 5. file_end ──────────────────>|
     |                                    |
     |<─── 6. file_complete ──────────────|
```

### 5.2 Message Definitions

#### 5.2.1 `file_start`

```typescript
type LanTransferFileStartMessage = {
  type: 'file_start';
  transferId: string;    // UUID, unique transfer identifier
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksum: string;      // SHA-256 hash of entire file (hex)
  totalChunks: number;
  chunkSize: number;
}
```

#### 5.2.2 `file_start_ack`

```typescript
type LanTransferFileStartAckMessage = {
  type: 'file_start_ack';
  transferId: string;
  accepted: boolean;
  message?: string;      // Rejection reason
}
```

#### 5.2.3 `file_chunk` — Binary Frame

See section 4.2 for frame format. `Data` is raw file binary data. Integrity relies on `file_start.checksum` (full file SHA-256).

#### 5.2.4 `file_end`

```typescript
type LanTransferFileEndMessage = {
  type: 'file_end';
  transferId: string;
}
```

#### 5.2.5 `file_complete`

```typescript
type LanTransferFileCompleteMessage = {
  type: 'file_complete';
  transferId: string;
  success: boolean;
  filePath?: string;     // Save path (on success)
  error?: string;        // Error message (on failure)
}
```

### 5.3 Checksum

```typescript
async function calculateFileChecksum(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}
```

### 5.4 Chunk Size

```typescript
const CHUNK_SIZE = 512 * 1024 // 512KB
const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
```

---

## 6. Heartbeat and Keep-alive

### 6.1 Messages

- **`ping`** (Client → Server): `{ type: 'ping', payload?: string }`
- **`pong`** (Server → Client): `{ type: 'pong', received: boolean, payload?: string }`

### 6.2 Strategy

- Send `ping` immediately after successful handshake to verify connection
- Optional: periodically send heartbeats to keep the connection alive

---

## 7. Error Handling

### 7.1 Timeout Configuration

| Operation | Timeout | Description |
|-----------|---------|-------------|
| TCP Connection | 10s | Connection establishment timeout |
| Handshake | 10s | Waiting for `handshake_ack` |
| Transfer Complete | 60s | Waiting for `file_complete` |

### 7.2 Error Scenarios

| Scenario | Client Handling | Server Handling |
|----------|----------------|-----------------|
| TCP connection failure | Notify UI, allow retry | - |
| Handshake timeout | Disconnect, notify UI | Close socket |
| Handshake rejected | Show rejection reason | - |
| Chunk processing failure | Abort transfer, cleanup | Clean up temp files |
| Unexpected disconnect | Cleanup state, notify UI | Clean up temp files |
| Insufficient storage | - | Send `accepted: false` |

---

## 8. Constants and Configuration

```typescript
export const LAN_TRANSFER_PROTOCOL_VERSION = '1'
export const LAN_TRANSFER_SERVICE_TYPE = 'cherrystudio'
export const LAN_TRANSFER_SERVICE_FULL_NAME = '_cherrystudio._tcp'
export const LAN_TRANSFER_TCP_PORT = 53317
export const LAN_TRANSFER_CHUNK_SIZE = 512 * 1024         // 512KB
export const LAN_TRANSFER_GLOBAL_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes
export const LAN_TRANSFER_HANDSHAKE_TIMEOUT_MS = 10_000
export const LAN_TRANSFER_CHUNK_TIMEOUT_MS = 30_000
export const LAN_TRANSFER_COMPLETE_TIMEOUT_MS = 60_000

export const LAN_TRANSFER_ALLOWED_EXTENSIONS = ['.zip']
export const LAN_TRANSFER_ALLOWED_MIME_TYPES = ['application/zip', 'application/x-zip-compressed']
```

---

## 9. Complete Sequence Diagram

```
┌─────────┐                           ┌─────────┐                           ┌─────────┐
│ Renderer│                           │  Main   │                           │ Mobile  │
│  (UI)   │                           │ Process │                           │ Server  │
└────┬────┘                           └────┬────┘                           └────┬────┘
     │                                     │                                     │
     │  ═══════ Service Discovery ═════════                                      │
     │ startScan()                         │                                     │
     │────────────────────────────────────>│ mDNS browse                         │
     │                                     │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│
     │                                     │<─ ─ ─ service discovered ─ ─ ─ ─ ─ ─│
     │<────── onServicesUpdated ───────────│                                     │
     │                                     │                                     │
     │  ═══════ Handshake ════════════════                                       │
     │ connect(peer)                       │                                     │
     │────────────────────────────────────>│──────── TCP Connect ───────────────>│
     │                                     │──────── handshake ─────────────────>│
     │                                     │<─────── handshake_ack ──────────────│
     │                                     │──────── ping ──────────────────────>│
     │                                     │<─────── pong ───────────────────────│
     │<────── connect result ──────────────│                                     │
     │                                     │                                     │
     │  ═══════ File Transfer ════════════                                       │
     │ sendFile(path)                      │                                     │
     │────────────────────────────────────>│──────── file_start ────────────────>│
     │                                     │<─────── file_start_ack ─────────────│
     │                                     │──────── file_chunk[0] (binary) ────>│
     │<────── progress event ──────────────│                                     │
     │                                     │──────── file_chunk[1] (binary) ────>│
     │<────── progress event ──────────────│         ... repeat ...              │
     │                                     │──────── file_end ──────────────────>│
     │                                     │<─────── file_complete ──────────────│
     │<────── complete event ──────────────│                                     │
```

---

## 10. Mobile Implementation Guide (v1)

### 10.1 Required Features

1. **mDNS Service Publishing**: Publish `_cherrystudio._tcp` service on TCP port `53317`
2. **TCP Server**: Listen on the specified port
3. **Message Parsing**: Control messages via UTF-8 + `\n` JSON; data messages via binary frames (Magic+TotalLen framing)
4. **Handshake Handling**: Validate `handshake`, send `handshake_ack`, respond to `ping`
5. **File Receiving (Streaming)**: Parse `file_start`, receive `file_chunk` binary frames (write to file + incremental hash), process `file_end`, send `file_complete`

### 10.2 Recommended Libraries

**React Native / Expo:**

- mDNS: `react-native-zeroconf` or `@homielab/react-native-bonjour`
- TCP: `react-native-tcp-socket`
- Crypto: `expo-crypto` or `react-native-quick-crypto`

---

## Appendix A: TypeScript Type Definitions

Complete type definitions are located in `packages/shared/config/types.ts`. See the source code for the full interface definitions.

## Appendix B: Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12 | Initial release with binary frame format and streaming transfer |
