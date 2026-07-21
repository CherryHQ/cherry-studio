# Update Configuration System Design Document

> **Compatibility note**: Current clients no longer read `app-upgrade-config.json`. The file remains only as a legacy artifact for already-released clients, but this repository no longer updates it automatically.

Current clients check for updates through `https://releases.cherry-ai.com`. The client selects only the `latest`, `rc`, or `beta` manifest and sends `App-Version`, `OS`, `Client-Id`, and `X-Region`. Client requests are the default, so the app omits `X-Release-Channel`. The release service determines the concrete version, regional mirror, rollout audience, and required upgrade gateway.

A test channel expresses the least stable build the user accepts; it does not permanently pin the user to a prerelease suffix. Beta requests select the highest version visible to that user across Beta, RC, and stable policies. RC requests select the highest visible RC or stable version. Stable requests receive stable releases only. The service redirects to the manifest that matches the selected release, allowing Beta users to advance naturally to RC and stable releases.

## Legacy Client Background

Legacy AppUpdater implementations queried a static JSON configuration file from GitHub or GitCode based on IP geolocation. The file contains update URLs for each channel and remains documented only to explain the old-client upgrade path.

## Design Goals

1. Support different configuration sources based on IP geolocation (GitHub/GitCode)
2. Support version compatibility control (e.g., users below v1.x must upgrade to v1.7.0 before upgrading to v2.0)
3. Easy to extend, supporting future multi-major-version upgrade paths (v1.6 → v1.7 → v2.0 → v2.8 → v3.0)
4. Maintain compatibility with existing electron-updater mechanism

## Current Version Strategy

- **v1.7.x** is the last version of the 1.x series
- Users **below v1.7.0** must first upgrade to v1.7.0 (or higher 1.7.x version)
- Users **v1.7.0 and above** can directly upgrade to v2.x.x

## Legacy Configuration Status

The `app-upgrade-config.json` copies hosted on the `x-files/app-upgrade-config` branch and its mirrors are retained only for already-released clients. This repository no longer provides a workflow, script, or package command for updating them. Retiring the legacy files requires a separate migration plan for those clients.

## JSON Configuration File Format

### File Location

- **GitHub**: `https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/x-files/app-upgrade-config/app-upgrade-config.json`
- **GitCode**: `https://gitcode.com/CherryHQ/cherry-studio/raw/x-files/app-upgrade-config/app-upgrade-config.json`

**Note**: Both mirrors provide the same configuration file hosted on the `x-files/app-upgrade-config` branch. Legacy clients select the mirror based on IP geolocation.

### Configuration Structure (Current Implementation)

```json
{
  "lastUpdated": "2025-01-05T00:00:00Z",
  "versions": {
    "1.6.7": {
      "minCompatibleVersion": "1.0.0",
      "description": "Last stable v1.7.x release - required intermediate version for users below v1.7",
      "channels": {
        "latest": {
          "version": "1.6.7",
          "feedUrls": {
            "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.6.7",
            "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/download/v1.6.7"
          }
        },
        "rc": {
          "version": "1.6.0-rc.5",
          "feedUrls": {
            "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.6.0-rc.5",
            "gitcode": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.6.0-rc.5"
          }
        },
        "beta": {
          "version": "1.6.7-beta.3",
          "feedUrls": {
            "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.7.0-beta.3",
            "gitcode": "https://github.com/CherryHQ/cherry-studio/releases/download/v1.7.0-beta.3"
          }
        }
      }
    },
    "2.0.0": {
      "minCompatibleVersion": "1.7.0",
      "description": "Major release v2.0 - required intermediate version for v2.x upgrades",
      "channels": {
        "latest": null,
        "rc": null,
        "beta": null
      }
    }
  }
}
```

### Future Extension Example

When releasing v3.0, if users need to first upgrade to v2.8, you can add:

```json
{
  "2.8.0": {
    "minCompatibleVersion": "2.0.0",
    "description": "Stable v2.8 - required for v3 upgrade",
    "channels": {
      "latest": {
        "version": "2.8.0",
        "feedUrls": {
          "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v2.8.0",
          "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/download/v2.8.0"
        }
      },
      "rc": null,
      "beta": null
    }
  },
  "3.0.0": {
    "minCompatibleVersion": "2.8.0",
    "description": "Major release v3.0",
    "channels": {
      "latest": {
        "version": "3.0.0",
        "feedUrls": {
          "github": "https://github.com/CherryHQ/cherry-studio/releases/latest",
          "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/latest"
        }
      },
      "rc": {
        "version": "3.0.0-rc.1",
        "feedUrls": {
          "github": "https://github.com/CherryHQ/cherry-studio/releases/download/v3.0.0-rc.1",
          "gitcode": "https://gitcode.com/CherryHQ/cherry-studio/releases/download/v3.0.0-rc.1"
        }
      },
      "beta": null
    }
  }
}
```

### Field Descriptions

- `lastUpdated`: Last update time of the configuration file (ISO 8601 format)
- `versions`: Version configuration object, key is the version number, sorted by semantic versioning
  - `minCompatibleVersion`: Minimum compatible version that can upgrade to this version
  - `description`: Version description
  - `channels`: Update channel configuration
    - `latest`: Stable release channel
    - `rc`: Release Candidate channel
    - `beta`: Beta testing channel
    - Each channel contains:
      - `version`: Version number for this channel
      - `feedUrls`: Multi-mirror URL configuration
        - `github`: electron-updater feed URL for GitHub mirror
        - `gitcode`: electron-updater feed URL for GitCode mirror
  - `metadata`: Historical segment information
    - `segmentId`: Legacy segment identifier
    - `segmentType`: Optional legacy flag (`legacy` | `breaking` | `latest`)

## TypeScript Type Definitions

```typescript
// Mirror enum
enum UpdateMirror {
  GITHUB = 'github',
  GITCODE = 'gitcode'
}

interface UpdateConfig {
  lastUpdated: string
  versions: {
    [versionKey: string]: VersionConfig
  }
}

interface VersionConfig {
  minCompatibleVersion: string
  description: string
  channels: {
    latest: ChannelConfig | null
    rc: ChannelConfig | null
    beta: ChannelConfig | null
  }
  metadata?: {
    segmentId: string
    segmentType?: 'legacy' | 'breaking' | 'latest'
  }
}

interface ChannelConfig {
  version: string
  feedUrls: Record<UpdateMirror, string>
  // Equivalent to:
  // feedUrls: {
  //   github: string
  //   gitcode: string
  // }
}
```

## Legacy Segment Metadata

Entries may still contain `metadata.segmentId` and `metadata.segmentType` values produced by the removed automation. They are historical data in the retained legacy configuration and are not consumed by current clients.

## Version Matching Logic

### Algorithm Flow

1. Get user's current version (`currentVersion`) and requested channel (`requestedChannel`)
2. Get all version numbers from configuration file, sort in descending order by semantic versioning
3. Iterate through the sorted version list:
   - Check if `currentVersion >= minCompatibleVersion`
   - Check if the requested `channel` exists and is not `null`
   - If conditions are met, return the channel configuration
4. If no matching version is found, return `null`

### Pseudocode Implementation

```typescript
function findCompatibleVersion(
  currentVersion: string,
  requestedChannel: UpgradeChannel,
  config: UpdateConfig
): ChannelConfig | null {
  // Get all version numbers and sort in descending order
  const versions = Object.keys(config.versions).sort(semver.rcompare)

  for (const versionKey of versions) {
    const versionConfig = config.versions[versionKey]
    const channelConfig = versionConfig.channels[requestedChannel]

    // Check version compatibility and channel availability
    if (
      semver.gte(currentVersion, versionConfig.minCompatibleVersion) &&
      channelConfig !== null
    ) {
      return channelConfig
    }
  }

  return null // No compatible version found
}
```

## Upgrade Path Examples

### Scenario 1: v1.6.5 User Upgrade (Below 1.7)

- **Current Version**: 1.6.5
- **Requested Channel**: latest
- **Match Result**: 1.7.0
- **Reason**: 1.6.5 >= 0.0.0 (satisfies 1.7.0's minCompatibleVersion), but doesn't satisfy 2.0.0's minCompatibleVersion (1.7.0)
- **Action**: Prompt user to upgrade to 1.7.0, which is the required intermediate version for v2.x upgrade

### Scenario 2: v1.6.5 User Requests rc/beta

- **Current Version**: 1.6.5
- **Requested Channel**: rc or beta
- **Match Result**: 1.7.0 (latest)
- **Reason**: 1.7.0 version doesn't provide rc/beta channels (values are null)
- **Action**: Upgrade to 1.7.0 stable version

### Scenario 3: v1.7.0 User Upgrades to Latest

- **Current Version**: 1.7.0
- **Requested Channel**: latest
- **Match Result**: 2.0.0
- **Reason**: 1.7.0 >= 1.7.0 (satisfies 2.0.0's minCompatibleVersion)
- **Action**: Directly upgrade to 2.0.0 (current latest stable version)

### Scenario 4: v1.7.2 User Upgrades to RC Version

- **Current Version**: 1.7.2
- **Requested Channel**: rc
- **Match Result**: 2.0.0-rc.1
- **Reason**: 1.7.2 >= 1.7.0 (satisfies 2.0.0's minCompatibleVersion), and rc channel exists
- **Action**: Upgrade to 2.0.0-rc.1

### Scenario 5: v1.7.0 User Upgrades to Beta Version

- **Current Version**: 1.7.0
- **Requested Channel**: beta
- **Match Result**: 2.0.0-beta.1
- **Reason**: 1.7.0 >= 1.7.0, and beta channel exists
- **Action**: Upgrade to 2.0.0-beta.1

### Scenario 6: v2.5.0 User Upgrade (Future)

Assuming v2.8.0 and v3.0.0 configurations have been added:
- **Current Version**: 2.5.0
- **Requested Channel**: latest
- **Match Result**: 2.8.0
- **Reason**: 2.5.0 >= 2.0.0 (satisfies 2.8.0's minCompatibleVersion), but doesn't satisfy 3.0.0's requirement
- **Action**: Prompt user to upgrade to 2.8.0, which is the required intermediate version for v3.x upgrade

## Current Client Implementation

The client no longer stores or switches the update service URL in TypeScript, and it does not call electron-updater's runtime feed-switching API.

- Packaged builds use `publish.url` from `electron-builder.yml`. electron-builder writes it to the packaged `app-update.yml`.
- Development mode sets `forceDevUpdateConfig = true`, so electron-updater reads `dev-app-update.yml` from the project root.
- Packaged builds default to `https://releases.cherry-ai.com`, while development mode defaults to the local Docker service at `http://127.0.0.1:3378`. Both URLs stay in configuration files; do not add another runtime URL constant.

Before each update check, `AppUpdater` only:

1. Selects the `latest`, `rc`, or `beta` manifest from the test-plan setting.
2. Resolves `X-Region` to `cn` or `global` from the IP country.
3. Sets the `App-Version`, `OS`, `Client-Id`, `App-Name`, and region headers.
4. Sets electron-updater's channel and calls `checkForUpdates()`.

The release service chooses the concrete version, regional mirror, rollout group, and required upgrade gateway. The client does not read the legacy `app-upgrade-config.json` or construct GitHub/GitCode download URLs itself.

## Current Error Handling

1. If IP lookup fails, the IP service's fallback result determines the region; the update service URL does not change.
2. If the release service has no available version, electron-updater follows its normal “update not available” path.
3. A network error is logged and ends the current check; the next check uses the same URL from the configuration file.

## GitHub Release Requirements

To support intermediate version upgrades, the following files need to be retained:

- **v1.7.0 release** and its latest*.yml files (as upgrade target for users below v1.7)
- Future intermediate versions (e.g., v2.8.0) need to retain corresponding release and latest*.yml files
- Complete installation packages for each version

### Currently Required Releases

| Version | Purpose | Must Retain |
|---------|---------|-------------|
| v1.7.0 | Upgrade target for users below 1.7 | ✅ Yes |
| v2.0.0-rc.1 | RC testing channel | ❌ Optional |
| v2.0.0-beta.1 | Beta testing channel | ❌ Optional |
| latest | Latest stable version (automatic) | ✅ Yes |

## Advantages

1. **Flexibility**: Supports arbitrarily complex upgrade paths
2. **Extensibility**: Adding new versions only requires adding new entries to the configuration file
3. **Maintainability**: Configuration is separated from code, allowing upgrade strategy adjustments without releasing new versions
4. **Multi-source support**: Automatically selects optimal configuration source based on geolocation
5. **Version control**: Enforces intermediate version upgrades, ensuring data migration and compatibility

## Future Extensions

- Support more granular version range control (e.g., `>=1.5.0 <1.8.0`)
- Support multi-step upgrade path hints (e.g., notify user needs 1.5 → 1.8 → 2.0)
- Support A/B testing and gradual rollout
- Support local caching and expiration strategy for configuration files
