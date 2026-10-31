---
description: Compare main features, data processing methods, and post-upgrade review items between V1 and V2.
icon: table-columns
---
# Feature Differences

V2 adjusted the data structure and multiple feature entry points. Before upgrading, review the items that require reconfiguration; for specific steps, see [**Upgrade from V1 to V2**](v1-to-v2-migration.md).

## V2 Migration Changes

| Scenario | V2 Handling | Notes |
| --------- | ----------------------- | ------------------------------ |
| First-time migration from V1 | You can install V2 directly from V1.9.13 | No intermediate V2 release is required. |
| Standard V2 upgrade | Upgrade directly and continue using current V2 data | Do not click **Re-migrate**. |
| Re-migrate from V1 | Select **Re-migrate** in **Settings** → **Data** | Current V2 data will be permanently deleted. This is only for cases where previous migration failed or data was missed. |

{% hint style="danger" %}
**Re-migrate** does not merge V1 data into the current V2. It first deletes the current V2 data and then re-imports from the retained V1 data. Do not click this unless the V1 migration failed or data was missed.
{% endhint %}

## Data Handling

| Handling Method | Data Scope | Actions After Upgrade |
| ---- | --------------------------------------------------------------------- | ------------- |
| Automatic Migration | Settings, model services and models, assistants and groups, sessions and messages, Agent and sessions, MCP, knowledge bases and valid indexes, files, drawing, translation, notes, prompts, usage records | Spot-check that common items open correctly. |
| Requires Review | Anthropic credentials, default web search service, Agent tool permissions and knowledge base bindings, prompt order, failed knowledge base items, custom CSS, sidebar favorites, missing files | Re-verify according to the table below. |
| Not Inherited | Agent scheduled task history, legacy sitemap expansion results, some temporary image references, current note open state, configurations for removed features | Recreate if needed. |

{% hint style="info" %}
Migration does not delete original V1 data. New V2 data is not synced back to V1, and backups between the two versions cannot be restored to each other.
{% endhint %}

## Key Differences

| Feature | V1 | V2 | Actions After Upgrade |
| --------------- | ------------------------------- | --------------------------------------------- | -------------------------------- |
| Assistants and Prompts | Independent assistant library; quick phrases can be associated with assistants | Assistants are managed in Chat and Agent; quick phrases are merged into global prompts | Check assistant groups and prompt order. |
| Agent | Some configurations and workspaces follow the session; old authorizations can auto-approve tools | Identity, memory, and main configurations belong to the Agent; workspace is fixed after session creation; tools may request re-authorization | Check models, workspaces, tools, and permissions. |
| Agent Knowledge Base | Knowledge tools may access the global knowledge base | Only accesses explicitly bound knowledge bases | Re-verify knowledge base bindings for each Agent. |
| Knowledge Base Retrieval | Can manually select retrieval mode and sitemap source | Uses BM25 when no embedding model is present; uses hybrid retrieval when an embedding model is present; sitemaps are treated as regular URLs | Check embedding and reranking models; rebuild failed sources. |
| Web Search | Service can be selected in assistant or input area; includes local search, RAG compression, and subscription blacklist | Configure keyword search and URL reading separately in **Settings** → **Web Search**; related legacy options removed | Re-select the two default services and check credentials. |
| MCP | Added services and third-party discovery market coexist | Added services continue to migrate; legacy third-party discovery market is no longer provided | Check service status; add new services from the current market or via JSON. |
| Model Services | Anthropic can save OAuth credentials | Anthropic OAuth is not migrated; AWS Bedrock region is retained; new services are disabled by default | Re-enter API Key for Anthropic and enable services as needed. |
| Files | File copies have weak reference relationships with business objects | Managed files are managed by reference; managed copies are cleaned up with a delay after the last reference is deleted | Place long-term retained files in **Files** or export them; user original files will not be deleted. |
| Drawing, Mini App, and Sidebar | Parameters and entry points are in legacy areas | Drawing parameters moved to the prompt toolbar; Mini App is in the top tab bar; sidebar favorites reset | Familiarize yourself with new entry points and reset favorites. |
| Custom CSS | V1 selectors take effect directly | Content is retained, but disabled by default after migration | Adapt to V2 selectors before enabling. |
| Code CLI | Can select iFlow | iFlow is replaced by Qoder | Switch to Qoder if relevant workflows are needed. |

## Developer Compatibility

<details>

<summary>What are the changes to API and external integrations?</summary>

* The model identifier in API Gateway has changed from `provider::model` to `provider:model`.
* Knowledge API returned entries use V2 fields.
* MCP-over-HTTP endpoints have been removed; this does not affect in-app MCP.
* SSE startup failures may directly return standard HTTP errors; clients must handle both HTTP and SSE error paths.
* Scheduled task interface parameters have changed; historical run records are not migrated.

</details>

## References

* [Upgrade from V1 to V2](v1-to-v2-migration.md)
* [Cherry Studio V2 Official Download](https://cherryai.com/download)
* V2 Release Page: [GitHub](https://github.com/CherryHQ/cherry-studio/releases)
