# Update Configuration System Design Document

## Background

Currently, AppUpdater directly queries the GitHub API to retrieve beta and rc update information. To support users in China, we need to fetch a static JSON configuration file from GitHub/GitCode based on IP geolocation, which contains update URLs for all channels.

## Design Goals

1. Support different configuration sources based on IP geolocation (GitHub/GitCode)
2. Support version compatibility control (e.g., users below v1.x must upgrade to v1.7.0 before upgrading to v2.0)
3. Easy to extend, supporting future multi-major-version upgrade paths (v1.6 → v1.7 → v2.0 → v2.8 → v3.0)
4. Maintain compatibility with existing electron-updater mechanism

## Current Version Strategy

- **v1.7.x** is the last version of the 1.x series
- Users **below v1.7.0** must first upgrade to v1.7.0 (or higher 1.7.x version)
- Users **v1.7.0 and above** can directly upgrade to v2.x.x

## JSON Configuration File Format

### File Location

- **GitHub**: `https://raw.githubusercontent.com/CherryHQ/cherry-studio/refs/heads/cs-releases/app-upgrade-config.json`
- **GitCode**: `https://gitcode.com/CherryHQ/cherry-studio/raw/cs-releases/app-upgrade-config.json`

**Note**: Both mirrors provide the same configuration file hosted on the `cs-releases` branch. The client automatically selects the optimal mirror based on IP geolocation.

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
  - `metadata`: Stable mapping info for automation
    - `segmentId`: ID from `config/app-upgrade-segments.json`
    - `segmentType`: Optional flag (`legacy` | `breaking` | `latest`) for documentation/debugging

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

## Segment Metadata & Breaking Markers

- **Segment definitions** now live in `config/app-upgrade-segments.json`. Each segment describes a semantic-version range (or exact matches) plus metadata such as `segmentId`, `segmentType`, `minCompatibleVersion`, and per-channel feed URL templates.
- Each entry under `versions` carries a `metadata.segmentId`. This acts as the stable key that scripts use to decide which slot to update, even if the actual semantic version string changes.
- Mark major upgrade gateways (e.g., `2.0.0`) by giving the related segment a `segmentType: "breaking"` and (optionally) `lockedVersion`. This prevents automation from accidentally moving that entry when other 2.x builds ship.
- Adding another breaking hop (e.g., `3.0.0`) only requires defining a new segment in the JSON file; the automation will pick it up on the next run.

## Automation Workflow

Starting from this change, `.github/workflows/update-app-upgrade-config.yml` listens to GitHub release events (published + prerelease). The workflow:

1. Checks out the default branch (for scripts) and the `cs-releases` branch (where the config is hosted).
2. Runs `yarn tsx scripts/update-app-upgrade-config.ts --tag <tag> --config ../cs/app-upgrade-config.json` to regenerate the config directly inside the `cs-releases` working tree.
3. If the file changed, it opens a PR against `cs-releases` via `peter-evans/create-pull-request`, with the generated diff limited to `app-upgrade-config.json`.

You can run the same script locally via `yarn update:upgrade-config --tag v2.1.6 --config ../cs/app-upgrade-config.json` (add `--dry-run` to preview) to reproduce or debug whatever the workflow does. Passing `--skip-release-checks` along with `--dry-run` lets you bypass the release-page existence check (useful when the GitHub/GitCode pages aren’t published yet). Running without `--config` continues to update the copy in your current working directory (main branch) for documentation purposes.

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

## Code Changes

### Main Modifications

1. **New Methods**
   - `_fetchUpdateConfig(ipCountry: string): Promise<UpdateConfig | null>` - Fetch configuration file based on IP
   - `_findCompatibleChannel(currentVersion: string, channel: UpgradeChannel, config: UpdateConfig): ChannelConfig | null` - Find compatible channel configuration

2. **Modified Methods**
   - `_getReleaseVersionFromGithub()` → Remove or refactor to `_getChannelFeedUrl()`
   - `_setFeedUrl()` - Use new configuration system to replace existing logic

3. **New Type Definitions**
   - `UpdateConfig`
   - `VersionConfig`
   - `ChannelConfig`

### Mirror Selection Logic

The client automatically selects the optimal mirror based on IP geolocation:

```typescript
private async _setFeedUrl() {
  const currentVersion = app.getVersion()
  const testPlan = configManager.getTestPlan()
  const requestedChannel = testPlan ? this._getTestChannel() : UpgradeChannel.LATEST

  // Determine mirror based on IP country
  const ipCountry = await getIpCountry()
  const mirror = ipCountry.toLowerCase() === 'cn' ? 'gitcode' : 'github'

  // Fetch update config
  const config = await this._fetchUpdateConfig(mirror)

  if (config) {
    const channelConfig = this._findCompatibleChannel(currentVersion, requestedChannel, config)
    if (channelConfig) {
      // Select feed URL from the corresponding mirror
      const feedUrl = channelConfig.feedUrls[mirror]
      this._setChannel(requestedChannel, feedUrl)
      return
    }
  }

  // Fallback logic
  const defaultFeedUrl = mirror === 'gitcode'
    ? FeedUrl.PRODUCTION
    : FeedUrl.GITHUB_LATEST
  this._setChannel(UpgradeChannel.LATEST, defaultFeedUrl)
}

private async _fetchUpdateConfig(mirror: 'github' | 'gitcode'): Promise<UpdateConfig | null> {
  const configUrl = mirror === 'gitcode'
    ? UpdateConfigUrl.GITCODE
    : UpdateConfigUrl.GITHUB

  try {
    const response = await net.fetch(configUrl, {
      headers: {
        'User-Agent': generateUserAgent(),
        'Accept': 'application/json',
        'X-Client-Id': configManager.getClientId()
      }
    })
    return await response.json() as UpdateConfig
  } catch (error) {
    logger.error('Failed to fetch update config:', error)
    return null
  }
}
```

## Fallback and Error Handling Strategy

1. **Configuration file fetch failure**: Log error, return current version, don't offer updates
2. **No matching version**: Notify user that current version doesn't support automatic upgrade
3. **Network exception**: Cache last successfully fetched configuration (optional)

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
