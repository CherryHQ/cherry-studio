---
description: Data migration, version paths, and rollback limitations to understand before upgrading to V2.
icon: triangle-exclamation
---
# Breaking Update Notice

V2 is not a standard overwrite update. It replaces the data structure and adjusts the entry points and behavior for features such as Assistants, Agents, Knowledge Bases, Web Search, and Files.

{% hint style="danger" %}
V1 data can only be migrated to V2 in one direction. New sessions, Agents, settings, and files created in V2 will not sync back to V1, and backups from V1 and V2 cannot be restored to each other.
{% endhint %}

## V2 Can Migrate V1 Directly

If you need to retain V1 data, follow the **V1.9.13 → V2 (direct data migration)** process; no intermediate V2 release is required.

| Current Status | Recommended Action |
| --------------- | --------------------------------- |
| Still on V1, need to retain data | Update V1 to 1.9.13, create a full backup, then install V2 directly. |
| Already using V2 | Upgrade to V2 normally and continue using your current V2 data. |
| Previous V1 migration failed or data was missed | First create a full backup of your current V2 data, then consider using [Re-migrate]. |
| Do not need V1 data | You can select [Ignore and Use Defaults], but V1 data will not be migrated. |

{% hint style="danger" %}
Upgrading to V2 normally does not require clicking [Re-migrate]. This action permanently deletes your current V2 data and re-imports from the original V1 data. Do not click this unless a previous V1 migration failed or data was missed.
{% endhint %}

## Required Before Upgrading

1. Update V1 to 1.9.13 and ensure it starts normally at least once.
2. Disable [Compact Backup] and create a full V1 backup.
3. Completely exit Cherry Studio, then copy the entire V1 data directory.
4. If using a custom directory or external disk, ensure the path is mounted and readable/writable.

The migration wizard reads the current V1 data directory, not the backup ZIP. Backups are for emergency recovery and cannot replace the original data directory during migration.

## [Re-migrate] Is Not Data Merging

V2 adds [Re-migrate] under [Settings] → [Data]. It is only for fixing cases where a previous V1 migration failed or data was missed.

Before proceeding, you must confirm the following:

* Current V2 data will be permanently deleted and cannot be undone.
* Original V1 data will be retained and re-imported after restart.
* You must create a full backup of your current V2 data first.

A full backup does not automatically merge V1 and V2 data. If you need to retain new V2 content, export it separately or keep a full backup.

{% hint style="danger" %}
The [v1 Legacy Data] option under [Settings] → [Data] → [Clear Cache] will delete the original V1 data required for [Re-migrate]. Do not clear this item until you have confirmed the migration result is complete and retained a separate backup.
{% endhint %}

## Key Checks After Upgrading

* Model services, API Keys, and default models; Anthropic OAuth will not be migrated, so you must use an API Key.
* Assistant groups, prompt order, Agent tool permissions, and Knowledge Base bindings.
* Knowledge Base failure sources, Web Search keyword search, and URL reading services.
* Custom CSS, sidebar favorites, and missing files.

See [Feature Differences](v1-v2-feature-differences.md) for a complete comparison.

## Migration Failure or Rollback

* Prefer using [Retry] to fix data directory, disk, or data issues and continue.
* [Save Issue Info] saves only locally; the file may contain paths, content, or credentials. Share it only with the Cherry Studio support team.
* [Ignore and Use Defaults] starts from default configurations; V1 data will not be migrated.
* Returning to V1 normally does not require deleting the database, and do not restore V2 backups to V1.

{% hint style="danger" %}
Do not manually delete or replace the database. If you make a mistake, cannot confirm the data directory, or need to re-migrate, keep all backups and data directories intact and contact the Cherry Studio support team.
{% endhint %}

## Continue Reading

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Feature Differences</strong></td><td>View automatic migrations, items requiring review, and content that will not be inherited.</td><td><a href="v1-v2-feature-differences.md">v1-v2-feature-differences.md</a></td></tr><tr><td><strong>V1 to V2 Upgrade</strong></td><td>Complete backup, migration, and verification in the correct version order.</td><td><a href="v1-to-v2-migration.md">v1-to-v2-migration.md</a></td></tr><tr><td><strong>V2 to V1 Downgrade</strong></td><td>Learn about rollback, backup, and database handling precautions.</td><td><a href="v2-to-v1-downgrade.md">v2-to-v1-downgrade.md</a></td></tr></tbody></table>

## Download Links

* [V1 Official Download](https://cherryai.com/download/v1)
* V2 Release Page: [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
* [V2 Official Download](https://cherryai.com/download)
