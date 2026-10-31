---
icon: book-open
---
# Building Knowledge Bases and Recall Testing

Start with [Getting Started with Knowledge Bases](../../knowledge-base/knowledge-base.md) for the complete create → import → test → use workflow. This page points advanced workflows to the relevant steps.

## Creating and Importing Materials

Choose the step you need below; begin with creation if this is your first knowledge base.

### 1. Open [Knowledge Base] → [New Knowledge Base]

See [Create a Knowledge Base](../../knowledge-base/create.md). An embedding model is optional: you can start with keyword search and add embeddings when needed.

### 2. Select Data Sources

See [Add and Organize Material](../../knowledge-base/sources.md) for files, folders, notes and URLs. For scanned documents, see [Document Preprocessing](../../knowledge-base/zhi-shi-ku-wen-dang-yu-chu-li.md).

### 3. Wait for Processing to Complete

Check the text and Chunks for missing or garbled content. See [Check Material and Recall](../../knowledge-base/recall-test.md) for the acceptance steps.

### 4. Perform Recall Testing

Use questions you already know the answers to, then inspect the source and complete context. Follow [Recall Testing](../../knowledge-base/recall-test.md) before binding the knowledge base to an Agent.

### Validate Recall Results with Real Questions

A finished import is not enough: the correct source and the conditions needed to answer must appear in the results. The [recall guide](../../knowledge-base/recall-test.md) explains how to diagnose missing, truncated or outdated results.

## Understanding RAG Settings

For embedding models, reranking, Top K and chunking, use [Model and Retrieval Settings](../../knowledge-base/emb-models-info.md). Change one setting at a time and repeat the same questions; re-index existing material when changing chunking settings.

### Use Case: Building an Internal Policy Q&A Library

Keep current policies together, test real questions, and check sources before using the library in an Agent. See [Knowledge Base Cases](../../knowledge-base/cases.md) and [Using with Agent](../../knowledge-base/agent.md) for the full workflow. Update or remove outdated policies and repeat recall testing when the source material changes.

<details>

<summary>Why are there no results after importing? </summary>

Check processing status and extracted text first; if an embedding model is configured, also check its connection. Follow [Knowledge Base Troubleshooting](../../knowledge-base/troubleshooting.md) to locate the failing step.

</details>
