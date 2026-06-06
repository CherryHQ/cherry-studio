# Cherry Studio Knowledge

This context defines the product language for Cherry Studio knowledge bases.

## Language

**Knowledge Base**:
A user-facing collection of materials that can be stored and searched. New knowledge bases should not require users to choose retrieval models before they can add or search materials.
_Avoid_: Vector knowledge base, RAG configuration

**Agent-Managed Knowledge Base**:
A knowledge base experience where users can add materials with minimal organization work, and Agents help organize, process, refresh, deduplicate, and maintain the knowledge base over time.
_Avoid_: Manual curation workspace, user-maintained database

**Agent Knowledge Maintenance**:
Agent actions that organize or maintain a knowledge base, such as moving material, creating summaries, refreshing snapshots, deduplicating content, or deleting material. Low-risk organization can be executed and reported; destructive or overwriting actions require user confirmation.
_Avoid_: Unbounded automation, silent deletion

**Folder-Based Knowledge Base**:
A knowledge base whose materials are organized under its own local root folder. It is the future default knowledge base shape; uploaded files and folders are copied into that root without renaming or reorganizing user content.
_Avoid_: File Mode as user-facing copy, vector database

**Knowledge Material Browser**:
The knowledge base detail view whose primary objects are the files and directories in the visible knowledge base folder. It can present the current directory as a list or grid; source, processing, indexing, refresh, and Agent-generated states decorate files and directories without replacing the real folder tree.
_Avoid_: Data-source-first view, virtual directory view, operation history

**Knowledge Material**:
A user-manageable member of a knowledge base, regardless of whether it originated from a file, folder, URL, note, cloud document, processor output, or Agent action. UI copy may still use a more concrete label when the design needs it.
_Avoid_: Data source, item, document

**Knowledge Base Creation**:
The user flow for adding a new knowledge base. Creating a new knowledge base only requires a name; retrieval models and ranking models are configured later as enhancements.
_Avoid_: Model-first creation, RAG setup flow

**Legacy RAG Knowledge Base**:
An existing knowledge base created through the older model-first RAG flow. It remains usable for compatibility and can be upgraded into a folder-based knowledge base copy.
_Avoid_: New knowledge base mode

**Knowledge Base Upgrade**:
The compatibility flow that creates a folder-based knowledge base copy from a legacy RAG knowledge base. Uploaded files and folders are rebuilt from managed internal files with folder hierarchy preserved only when the old data can prove that hierarchy; URL sources are captured into local markdown snapshots during upgrade; retrieval model settings are carried forward. Upgrade is a one-time copy and does not create synchronization between the old and new knowledge bases or automatically change Agent or Assistant knowledge configuration.
_Avoid_: In-place conversion, vector-only migration

**Original Material**:
The locally stored material a user adds to a knowledge base. Every uploaded or imported source becomes a knowledge-base-owned saved copy or snapshot: files and folders are copied, URLs are captured as saved local content, Cherry Studio notes copy their indexed local source file, and cloud sources are captured as saved local content. Summaries, reports, and indexes are derived from original material.
_Avoid_: Generated summary, wiki

**Material Deletion**:
Removing material from a knowledge base deletes the saved local copy and its searchable indexes. It does not delete the external file, URL, or cloud source that originally produced the material.
_Avoid_: Source deletion, index-only deletion

**Material Change Detection**:
The product behavior that detects changes to saved local material in a folder-based knowledge base and updates searchable indexes to match those changes. If material is deleted from the filesystem, the UI removes it and its indexes are cleaned without asking for another confirmation.
_Avoid_: Manual-only refresh, external source sync

**Material Name Conflict**:
A conflict that occurs when added material has the same path as existing material in the knowledge base. The user must choose whether to replace, keep both, or skip the incoming material; keeping both uses neutral numeric suffixes such as `_2` and `_3`.
_Avoid_: Silent rename, silent overwrite

**Duplicate Material**:
Material that may have the same or similar content as existing material but does not share the same path. The product does not block it by default; duplicate management can be handled later by the user or Agent.
_Avoid_: Automatic deduplication, upload rejection

**Captured Material**:
Original material created from an external or application-indexed source such as a URL, Cherry Studio note, or cloud document. It is a knowledge-base-owned saved snapshot, not a live reference. It can be refreshed explicitly by the user or by an Agent tool; refresh reads the source again, replaces the existing saved snapshot after user confirmation, and updates its searchable indexes. Moving or renaming the saved file does not remove its refresh identity when that identity can still be confirmed.
_Avoid_: Live external reference, real-time source

**Captured Material Location**:
The default visible location for captured external material. URL snapshots are added like regular material in the current directory; cloud document snapshots are grouped under a provider folder such as Feishu or Tencent Docs.
_Avoid_: Hidden capture cache, global web folder

**Cherry Note Snapshot**:
Original material created by importing a Cherry Studio note's indexed local source file into a knowledge base. The saved file keeps the source file's filename, belongs to the knowledge base after import, and is not automatically synchronized when the note or source file changes. Refresh is explicit and overwrites the saved snapshot after confirmation when the source identity is still available.
_Avoid_: Source note reference, automatic note sync

**Index Asset**:
A system-owned searchable artifact derived from original material. Index assets can be rebuilt and should not appear as user materials.
_Avoid_: User document, source material

**System Representation**:
A system-owned derivative generated only to make material readable, searchable, or indexable, such as extracted text from a PDF. It belongs to its source material and should not appear as a separate user material.
_Avoid_: User document, organized material

**Processed Material**:
Visible material generated by a user-selected file processor, such as markdown produced from an uploaded PDF. It is part of the knowledge base's visible folder tree and can be organized independently by the user or Agent; source metadata records where it came from but does not bind its lifecycle to the original file. By default it is created next to the source file with the same basename, and name conflicts use the normal material conflict flow.
_Avoid_: Hidden system representation

**Material Provenance**:
The remembered source relationship between one piece of material and another, such as a processed markdown file generated from a PDF. Provenance should survive ordinary moves and renames when the source identity can still be confirmed; if not, it is marked unavailable rather than guessed from path alone. Unavailable provenance does not make the material itself unusable.
_Avoid_: Path-only source, guessed source

**Processed Search Source**:
The searchable material used when a user-selected file processor creates visible processed material from an original file. Search indexes the processed material instead of indexing the original rich file as a duplicate source.
_Avoid_: Duplicate indexing, original-file embedding

**Organized Material**:
Visible material intentionally created, moved, or arranged by the user or an Agent inside the knowledge base. It appears in the knowledge base tree even when it is derived from other material.
_Avoid_: System representation, hidden artifact

**Agent-Generated Material**:
Visible material created by an Agent, such as a report, summary, or study note. It remains ordinary knowledge base material, but can keep provenance to the materials or locators the Agent used. Source changes can mark it stale, but should not regenerate or overwrite it automatically.
_Avoid_: Chat-only output, untraceable report

**Indexable Material**:
Original material that can be searched after being read as text. Text files, markdown, structured text, captured markdown, cloud snapshots, and Cherry note snapshots are directly indexable; binary or rich document formats must be converted before indexing.
_Avoid_: Unsupported material, vector-only material

**Full-Text Index**:
The default search index created with a folder-based knowledge base. It enables keyword search before any embedding model is configured.
_Avoid_: Optional index, vector index

**Semantic Index**:
An enhanced search index created only after an embedding model is configured for a knowledge base.
_Avoid_: Default index, required creation step

**Ranking Enhancement**:
An optional search enhancement that reorders search results after retrieval. It improves result ordering but does not determine whether a knowledge base is usable.
_Avoid_: Required search model, knowledge base dependency

**Search Locator**:
The source path and fragment position that identify where a search result came from inside a knowledge base. Agents use locators to read nearby context when search snippets are not enough.
_Avoid_: Untraceable snippet, source-less result

**Temporary Knowledge Context**:
A knowledge base context passed into an Agent conversation for that conversation only. It does not change the Agent or Assistant's persistent knowledge configuration.
_Avoid_: Persistent binding

**Mentioned Knowledge Base**:
A knowledge base referenced by the user in the current Agent turn or conversation, such as through an @ mention. Mentioning a knowledge base makes it a temporary search candidate, not a binding or permission boundary.
_Avoid_: Bound knowledge base, allowed knowledge base

**Agent Knowledge Base**:
A knowledge base configured on an Agent and carried into every Agent turn as a search candidate id.
_Avoid_: Permission scope, search-only allowlist

**Knowledge Tool**:
The Agent-facing ability to list knowledge bases, search explicit knowledge base ids, read search-located context, refresh captured material, and add or delete knowledge base material. Agent-bound knowledge bases and user-mentioned knowledge bases are supplied to the Agent as candidate ids in the prompt, but search is not restricted to those candidates.
_Avoid_: Search-only knowledge tool, filesystem fallback

**Agent-Added Material**:
Original material added to a knowledge base through an Agent tool. It follows the same saved-material and indexing semantics as material added manually by the user, including local paths, URLs, Cherry Studio notes, cloud document sources, and plain text notes.
_Avoid_: Temporary attachment, chat-only source

**Knowledge Context Read**:
The Agent-facing ability to read nearby context from a knowledge base by using a search locator. It is owned by the knowledge system so local files, cloud knowledge bases, and permission checks can share one product boundary.
_Avoid_: Filesystem fallback, unrestricted file read
