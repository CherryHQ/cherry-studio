---
description: Back up V1 data, directly use V2 to complete migration, and check items requiring reconfiguration.
icon: arrow-right-arrow-left
---
# Upgrading from V1 to V2

{% hint style="danger" %}
Migration is one-way: V1 data can be imported into V2, but new V2 data will not sync back to V1. Before upgrading, keep a complete V1 backup and a copy of the entire V1 data directory made after fully exiting the application.
{% endhint %}

{% hint style="warning" %}
The correct path for data retention is: **V1.9.13 → V2 (direct data migration)**; no intermediate V2 release is required.
{% endhint %}

## Choose Based on Your Current Situation

| Current Situation | Action |
| --------------- | ------------------------------------ |
| Still on V1, need to retain data | Update V1 to 1.9.13, then install V2 directly following the steps on this page. |
| Already using V2 | Upgrade to V2 normally and continue using your current V2 data; do not click [Re-migrate]. |
| Previous V1 migration failed or missed data | Only after fully backing up current V2, you can use [Re-migrate] to start over from V1. |
| Do not need V1 data | You can choose [Ignore and Use Defaults] to start with default settings; V1 data will not be migrated. |

## Pre-Upgrade Checklist

* V1 version is at least 1.9.12; it is recommended to update to the final version 1.9.13 and launch it at least once.
* For the first migration, you can use V2 directly.
* Custom data directories or external disks are readable and writable.
* All conversations, Agent tasks, knowledge base imports, and file processing tasks have finished.

{% hint style="warning" %}
The migration wizard reads the current V1 data directory, not the V1 backup ZIP. Backups are for accidental recovery and cannot replace the original data directory for migration.
{% endhint %}

## Steps

{% stepper %}
{% step %}
### Update and Back Up V1

Update V1 to 1.9.13. On the Data Backup page, turn off [Simplified Backup], create a full backup, and save the backup outside the application data directory.
{% endstep %}

{% step %}
### Copy the Entire V1 Data Directory

Confirm the directory location in V1's data settings, then copy the entire directory after fully exiting Cherry Studio. Do not copy only the database file.
{% endstep %}

{% step %}
### Check Custom Directories

When using a portable hard drive, network volume, or other custom location, ensure the path is mounted and readable/writable. If the path is inaccessible, do not switch to the default directory to continue migration.
{% endstep %}

{% step %}
### First Launch of V2

Download the V2 installer matching your system and chip from [V2 Official Download](https://cherryai.com/download), or use the [GitHub Release Page](https://github.com/CherryHQ/cherry-studio/releases). Fully exit V1 before installing and launching.
{% endstep %}

{% step %}
### Complete the [Data Migration Wizard]

Verify the data location displayed in the wizard, then select [Start Migration]. Do not close the application, move the data directory, or disconnect external disks during migration.
{% endstep %}

{% step %}
### Review Results and Restart

After migration is complete, expand any warning messages first, then select [Restart Application].
{% endstep %}
{% endstepper %}

## Post-Upgrade Checks

* Check common model services, API Keys, and the default model.
* Check assistant groups, prompts, Agent permissions, and knowledge base bindings.
* Open common conversations, knowledge bases, and files; only rebuild knowledge sources that show as failed.
* Re-confirm keyword search and URL reading services in [Settings] → [Web Search].
* Check sidebar favorites and custom CSS.
* Create a new full V2 backup in [Settings] → [Data].

See [Feature Differences](v1-v2-feature-differences.md) for more entry point changes.

## Use [Re-migrate] Only If Migration Failed

If a previous V1 migration failed or missed data, you can select [Re-migrate] in V2 under [Settings] → [Data]. This action restarts the application and re-executes migration from the retained V1 data.

{% hint style="danger" %}
[Re-migrate] permanently deletes current V2 data and does not merge V1 and V2 data. Do not click this unless a previous V1 migration failed or missed data. You must create a full backup of the current V2 before proceeding; any new V2 content you wish to retain should also be exported separately.
{% endhint %}

## If Migration Fails

| Option | When to Use | Notes |
| ---------- | --------------- | ---------------------------------------------- |
| [Retry] | After fixing directory, disk, or temporary data issues | Preferred option; does not exit the migration process. |
| [Save Issue Info] | If retry fails and you need assistance | The file is saved locally only and may contain paths, content, or credentials. Provide it only to the Cherry Studio support team. |
| [Ignore and Use Defaults] | If you explicitly abandon importing V1 data | Clears partially written V2 data from this attempt and starts with default settings; no automatic migration prompt will appear later. |
| [Continue Using V1] | If you cannot migrate temporarily and need to resume work | Reinstall V1 and continue using the original V1 data directory. |

{% hint style="danger" %}
If migration fails or you accidentally select [Ignore and Use Defaults], do not delete the database yourself or repeatedly overwrite the installation. Retain the original V1 data and backups, and contact the Cherry Studio support team.
{% endhint %}

## FAQ

<details>

<summary>I only have a V1 backup ZIP. Can I migrate directly?</summary>

No. First restore and verify the data in a compatible V1 version, retain the complete data directory, and then start the V2 migration.

</details>

<details>

<summary>Do I need to rebuild indexes for all knowledge bases?</summary>

No. Valid indexes will be migrated; only process sources that show as failed, lack an embedding model, or are unreadable.

</details>

## References

* [Cherry Studio V2 Official Download](https://cherryai.com/download)
* [Cherry Studio V1 Official Download](https://cherryai.com/download/v1)
* V2 Release Page: [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
* [Official Migration Design Notes](https://github.com/CherryHQ/cherry-studio/blob/main/src/main/data/migration/v2/README.md#version-compatibility-gate)
* [Issue Feedback and Feature Suggestions](../../question-contact/suggestions.md)
