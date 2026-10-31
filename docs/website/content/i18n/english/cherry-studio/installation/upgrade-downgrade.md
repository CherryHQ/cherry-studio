---
description: Select the version switch path, and protect V1 and V2 data before proceeding.
icon: arrows-rotate
---
# Upgrade and Downgrade

Select the instructions corresponding to your current version and target. V1 and V2 use different data structures; you must back up before switching between major versions.

{% hint style="danger" %}
V1 and V2 data and backup formats are not compatible. New sessions, Agents, settings, and files created in V2 will not automatically write back to V1.
{% endhint %}

## V2 Upgrade and Migration

{% hint style="warning" %}
If you need to retain V1 data, the correct path is: **V1.9.13 → V2 (direct data migration)**; no intermediate V2 release is required.
{% endhint %}

| Current Situation | Recommended Action |
| --------------- | ------------------------------------ |
| Still on V1, need to retain data | Update V1 to 1.9.13, then directly install V2 to complete migration. |
| Already using V2 | Upgrade to V2 normally and continue using current V2 data; do not click [Re-migrate]. |
| Previous V1 migration failed or missed data | After fully backing up current V2, you can use [Re-migrate] in [Settings] → [Data]. |
| Do not need V1 data | You can select [Ignore and use defaults], but V1 data will not be migrated. |

{% hint style="danger" %}
[Re-migrate] permanently deletes current V2 data and re-imports from the original V1 data. It does not merge or retain data from both sides. Do not click this unless a previous V1 migration failed or missed data.
{% endhint %}

## Choose Path

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Breaking Update Notice</strong></td><td>Confirm data incompatibility, re-migration, and rollback limitations first. </td><td><a href="v2-breaking-update-notice.md">v2-breaking-update-notice.md</a></td></tr><tr><td><strong>Feature Differences</strong></td><td>Understand changes in UI, Agents, Knowledge Base, etc., and items to review after upgrading. </td><td><a href="v1-v2-feature-differences.md">v1-v2-feature-differences.md</a></td></tr><tr><td><strong>Upgrade V1 to V2</strong></td><td>Back up V1 data and use V2 directly to complete migration. </td><td><a href="v1-to-v2-migration.md">v1-to-v2-migration.md</a></td></tr><tr><td><strong>Downgrade V2 to V1</strong></td><td>Return to original V1 data and understand when you need to handle the V2 database. </td><td><a href="v2-to-v1-downgrade.md">v2-to-v1-downgrade.md</a></td></tr></tbody></table>

## Pre-Switch Preparation

1. End any running conversations, Agents, Knowledge Base imports, and file processing tasks.
2. Create a new full backup of the current version and save it outside the application data directory.
3. Record the current application data directory; if using a custom directory or external disk, ensure the path is accessible.

{% hint style="warning" %}
Do not manually delete application data for a "complete uninstall." Database handling only applies when explicitly abandoning all V2 data or re-migrating; see [Downgrade V2 to V1](v2-to-v1-downgrade.md).
{% endhint %}

## Download Links

* [Cherry Studio V2 Official Download](https://cherryai.com/download)
* [Cherry Studio V1 Official Download](https://cherryai.com/download/v1)
* V2 Release Page: [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
