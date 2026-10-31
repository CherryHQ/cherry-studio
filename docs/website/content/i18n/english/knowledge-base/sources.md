---
icon: box-archive
---
# Adding and Organizing Sources

The knowledge base supports files, Cherry Studio notes, local directories, and individual web page URLs. After importing, verify the processing status, content, and Chunks, and re-index when sources are updated.

{% hint style="info" %}
The completion standard is not "the file appears in the list," but rather that the source is readable, Chunks are complete, and real questions retrieve the correct sources.
{% endhint %}

## Selecting the Correct Entry Point

<figure><img src="../../../assets/a04950b796f4347833202f60.webp" alt="The Add Data Source menu with File, Note, Folder and URL"><figcaption><p>Choose the entry based on the source type: File for a few files, Folder for a set of related files, Note for Cherry Studio notes, and URL for public web pages.</p></figcaption></figure>

| Entry Point | Suitable For | Relationship After Import | Key Considerations |
| -- | ----------------------- | ----------- | ------------------ |
| File | PDF, Office, Markdown, text, etc. | Saves a managed copy | Select up to 20 items per batch |
| Note | Content already organized in Cherry Studio | Imports a snapshot of the content at that time | Subsequent edits to the original note do not sync automatically |
| Folder | A batch of local files under the same topic | Creates source entries based on directory contents | Do not import unrelated directories in bulk |
| URL | A single publicly accessible web page | Saves a snapshot of the web page at the time of fetching | Login pages, script-rendered content, or restricted pages may be incomplete |

{% hint style="warning" %}
Supported file types include PDF, DOCX, DOC, PPTX, XLSX, XLS, MD, TXT, CSV, HTML, and EPUB. Scanned PDFs or image-based content also require OCR verification.
{% endhint %}

## Adding and Validating Sources

{% stepper %}
{% step %}
### 1. Select the Source Type

Open the knowledge base, click **Add Data Source**, and choose **File**, **Note**, **Folder**, or **URL**.
{% endstep %}

{% step %}
### 2. Confirm Selected Content

Files and notes can be selected in batches; interactive addition allows up to 20 items per session. For larger volumes, add in batches or use the Directory entry point.
{% endstep %}

{% step %}
### 3. Handle Name Conflicts

If a new source has the same name as an existing entry, choose **Keep All** or **Replace**. When updating policies, manuals, or note snapshots, typically choose **Replace**.

{% hint style="warning" %}
Choosing **Keep All** allows both old and new content to participate in retrieval. Only do this if you genuinely need to query different versions in parallel, and indicate the date or version in the name.
{% endhint %}
{% endstep %}

{% step %}
### 4. Wait for Processing to Complete

Sources go through stages including copying, reading, chunking, and indexing. If no embedding model is configured, vectors will not be created, but a keyword index will still be built.

<figure><img src="../../../assets/e0b7bca1e8f80854d96a85b7.webp" alt="A knowledge base list where every source shows the Ready status"><figcaption><p>Once a source shows <strong>Ready</strong>, spot-check the content and Chunks. </p></figcaption></figure>
{% endstep %}

{% step %}
### 5. Spot-Check Content and Chunks

Open the source to view the content, or view Chunks from the source row menu. Focus on checking whether heading order, tables, OCR text, and key sentences are incorrectly split.
{% endstep %}

{% step %}
### 6. Complete Retrieval Testing

Use a question with a clear answer to verify the correct source and snippet. After updating sources, re-test using the same set of questions.

<figure><img src="../../../assets/f134353a322ca6669467f2c9.webp" alt="Recall Test results listing matched chunks with their source file and rank"><figcaption><p>Enter a question in Recall Test and click Search. Matched chunks and scores appear in the panel; check the source, completeness and ranking.</p></figcaption></figure>
{% endstep %}
{% endstepper %}

## Source Status and Handling Methods

| Symptom | Possible Cause | Handling Method |
| ----------- | ------------------ | ------------------ |
| Processing for a long time | Large file size, parser or model unavailable | Check the original file, document processing, and embedding model |
| Error displayed | Copying, reading, chunking, or indexing failed | Open the error message and address the failed stage |
| Missing or garbled content | File processor incompatible, scanned content not OCR'd | Change the document processing method or configure OCR |
| Chunks missing key sentences | Chunk boundaries inappropriate | Adjust chunking and execute **Re-index** |
| Both old and new versions retrieved | **Keep All** selected for same-named sources | Delete the old entry, or re-import and select **Replace** |

## Re-indexing and Deletion

After changing chunking, parser, or embedding settings, old entries do not automatically apply the new settings. Use **Re-index** for a single source, or select multiple sources and re-index them in bulk.

{% hint style="danger" %}
Deleting an entry removes the managed copy and index from the current knowledge base. It does not delete the original file or note, but confirm whether the knowledge base holds the only copy before deleting.
{% endhint %}

## Configuration Notes

| Configuration Item | Product Default | Recommended Starting Point | Function | Applicable Scenarios | Considerations |
| ------ | ------- | ---------- | --------------- | ---------- | ---------------- |
| Items per addition | Max 20 items | Start with a small number of representative sources | Controls import batch size | Initial setup or troubleshooting | Verify parsing and retrieval before bulk imports |
| Name conflict handling | Choose when conflict occurs | Prefer **Replace** for updates | Determines if old and new entries coexist | Policy, manual, or note updates | **Keep All** may allow old content to participate in retrieval |
| Re-indexing | Manual execution | Execute after setting changes | Applies new parsing, chunking, or models to old sources | Tuning or fixing sources | Must re-run retrieval tests after completion |

## User Case

Xiao Lin updates the travel policy monthly. He imports the new file with the same name and selects **Replace**. After processing completes, he spot-checks the content and Chunks, then tests lodging, transportation, and approval rules using fixed questions.

The completion standard is: old rules no longer appear in retrieval results, and the conditions and amounts of new rules are consistently retrieved.

## Frequently Asked Questions

<details>

<summary>Does the knowledge base update automatically after modifying the original note? </summary>

No. Notes import a snapshot of the content at that time. After modifications, you must re-add and select **Replace**, or execute **Re-index** for the corresponding source.

</details>

<details>

<summary>Why does a web page only fetch partial content? </summary>

Web pages requiring login, relying on script rendering, or having access restrictions may not be fully fetched. You can save the content as a file or note and then import it.

</details>

<details>

<summary>Does deleting a knowledge base entry delete the original file? </summary>

It does not delete the original file or note, but it removes the managed copy and index from the knowledge base.

</details>

## Continue Reading

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Document Parsing and OCR </strong></td><td>Handle missing content, garbled text, and scanned content. </td><td><a href="document-preprocessing.md">document-preprocessing.md </a></td></tr><tr><td><strong>Checking Sources and Retrieval </strong></td><td>Validate retrieval quality using fixed questions. </td><td><a href="recall-test.md">recall-test.md </a></td></tr><tr><td><strong>Data, Privacy, and Maintenance </strong></td><td>Understand backups, deletion, and service boundaries. </td><td><a href="data.md">data.md </a></td></tr></tbody></table>
