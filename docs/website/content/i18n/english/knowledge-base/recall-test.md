---
icon: flask
---
# Verify Sources and Recall

Recall testing directly checks whether a question can find the correct snippet, without first passing through the chat model for refinement. It helps you determine whether the issue lies in the source material, parsing, chunking, or retrieval settings.

{% hint style="info" %}
Prepare 3–5 real questions where you already know the answer, and reuse them every time you update materials, models, or chunks. Fixed questions make it easier to detect regressions than ad-hoc testing.
{% endhint %}

## Prepare Test Questions

It is recommended to cover three types of questions:

* Precise facts, e.g., "What is the accommodation cap for first-tier cities in China?"
* Conditional rules, e.g., "Under what circumstances can overseas car rentals be reimbursed?"
* Easily confused items, e.g., "Who provides additional approval for business trips exceeding $1,000?"

Do not test only with document titles or verbatim sentences from the source, as this overestimates real-world performance.

## Complete a Recall Test

{% stepper %}
{% step %}
### 1. Open Recall Test

Open the left navigation [Knowledge Base] → Select a knowledge base → Enter [Recall Test].
{% endstep %}

{% step %}
### 2. Enter a Real Question

Enter a question with a clear answer and run the test. The question should resemble natural daily phrasing; do not deliberately copy the source text.
{% endstep %}

{% step %}
### 3. Check Sources and Snippets

Confirm the source is correct and that the snippet contains both the conditions and the conclusion required for the answer.

<figure><img src="../../../assets/f134353a322ca6669467f2c9.webp" alt="Recall Test results listing matched chunks with their source file and rank"><figcaption><p>Click Recall Test at the top right of the knowledge base, enter a question and click Search. Then check the source, snippet completeness and order of the matched chunks.</p></figcaption></figure>
{% endstep %}

{% step %}
### 4. Diagnose Based on Symptoms

If no correct snippet appears, first check the source material, parsing, and chunking. If correct snippets appear but the order is unstable, then consider embeddings, reranking, or Top K.
{% endstep %}

{% step %}
### 5. Adjust One Item and Retest

Change only one setting per round. If parsing, chunking, or indexing is involved, execute [Reindex] first, then retest with the same set of questions.
{% endstep %}
{% endstepper %}

## How to Read Results

| Symptom | Description | Next Step |
| ------------- | --------------------- | ---------------------- |
| Correct source ranks high, snippet is complete | Recall is basically acceptable | Test a few different phrasings |
| No correct results at all | Material not ready, content missing, large phrasing difference, or threshold too high | Check material, body text, Chunks, and retrieval settings in order |
| Source is correct but snippet lacks key sentences | Parsing or chunking boundaries are suboptimal | Review Chunks, adjust, and reindex |
| Old and new versions appear simultaneously | Same-named materials were all retained | Delete old entries or use [Replace] to re-import |
| Correct items often rank low | Too many candidates or unstable ranking | Clean up materials, consider embedding or reranking models |
| Recall is correct but chat answer is inaccurate | Issue is likely in the prompt or chat model | Keep recall settings, adjust the question and chat model |

{% hint style="warning" %}
The chat model cannot recover key materials that were not found during the recall stage. If recall results are poor, do not troubleshoot by repeatedly switching chat models first.
{% endhint %}

## Tuning Loop

<figure><img src="../../../assets/61dbda9b15a8ecba70f214fe.webp" alt="Quality tuning loop: check recall with fixed questions, locate issues, adjust individually, re-index, and retest"><figcaption><p>Fixed questions → Check results → Identify layer → Adjust one item → Reindex if necessary → Retest. </p></figcaption></figure>

Recommended order:

1. Confirm materials are correct, with no duplicates or outdated versions.
2. Check parsed body text and Chunks.
3. If the phrasing differs significantly from the source, consider the embedding model.
4. If candidates are roughly correct but the order is unstable, consider the reranking model.
5. Reindex after adjustments and repeat the same set of tests.

## Configuration Notes

| Setting | Product Default | Suggested Start | Function | Use Case | Notes |
| ------ | ------------ | -------- | ---------- | ---------- | ----------------- |
| Test Question Count | — | 3–5 | Establish a repeatable quality baseline | All knowledge bases | Cover precise facts, conditional rules, and easily confused questions |
| Top K | 6, range 1–50 | Keep 6 initially | Control the final number of snippets | Balance between coverage and noise | Increasing may consume more context |
| Similarity Threshold | 0.0, shown only after configuring reranking | Start from 0.0 | Filter low-score results after reranking | Noise remains after reranking | Setting too high may remove correct snippets |
| Retest Method | — | Change one item per round | Determine where setting changes originate | Tuning, updating materials or models | Reindex first after modifying chunking or models |

## Expected Results

* Correct sources consistently appear in the top few results.
* Snippets contain the conditions and conclusions needed to answer the question.
* Results remain stable when using different natural phrasings.
* No significant regression in fixed questions after updating materials or settings.

## User Case

Xiao Lin found that "accommodation standards" could be hit using the original text, but "how much can I claim for hotel stays" was unstable. He first confirmed that the materials and Chunks were normal, then configured the embedding model and retested. After correct snippets appeared but occasionally ranked low, he added a reranking model.

The completion standard is: three different phrasings all find the same accommodation standard in the top few results, and the snippet includes the applicable city and amount cap.

## FAQ

<details>

<summary>No correct snippets at all; should I increase Top K first? </summary>

Check the material body text and Chunks first. If parsing or splitting is incorrect, increasing Top K will only return more incorrect or incomplete snippets.

</details>

<details>

<summary>Why is the Similarity Threshold not visible? </summary>

The [Similarity Threshold] is only displayed in knowledge base settings after selecting a reranking model.

</details>

<details>

<summary>Recall is correct, but the chat answer is still inaccurate. What should I do? </summary>

Keep the current recall settings and check the question phrasing, conversation context, and chat model. At this point, the issue is usually no longer in the material retrieval layer.

</details>

## Continue Reading

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Models and Retrieval Settings </strong></td><td>Adjust embeddings, reranking, Top K, and chunking. </td><td><a href="emb-models-info.md">emb-models-info.md </a></td></tr><tr><td><strong>Document Parsing and OCR </strong></td><td>Handle missing body text, garbled characters, and scanned content. </td><td><a href="document-preprocessing.md">document-preprocessing.md </a></td></tr><tr><td><strong>Use in Conversations </strong></td><td>Use the knowledge base for questions after recall is qualified. </td><td><a href="chat.md">chat.md </a></td></tr></tbody></table>
