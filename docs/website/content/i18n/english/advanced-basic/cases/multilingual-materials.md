---
icon: globe
---
# Multilingual Material Preparation

The marketing team receives a set of materials including documents, screenshots, and product terminology that need to be translated into another language while maintaining consistency in names, numbers, and formatting. A glossary and a small-scale trial translation can reduce rework for the entire material set.

<figure><img src="../../../../assets/58e56b2ba6cf637b831f0efb.webp" alt="The workflow diagram showing how materials are retrieved via Knowledge Base search, organized by the Agent, and turned into translated or content deliverables"><figcaption><p>First, ensure accurate material retrieval, then have the Agent unify terminology and output format, and finally manually verify key content. </p></figcaption></figure>

<figure><img src="../../../../assets/4e6d327879ccf512db663bc4.webp" alt="The Translate page with the source text on the left and the translation on the right"><figcaption><p>Keep the original text on the left and the translation on the right. Before delivery, check key terms sentence by sentence.</p></figcaption></figure>

## Workflow

{% stepper %}
{% step %}
### 1. Establish a Glossary First

List product names, feature names, personal names, units, and legal statements that cannot be rewritten. Specify the target language usage for each term.
{% endstep %}

{% step %}
### 2. Calibrate Style with a Small Section

In [Translation], first process a representative section to confirm the level of formality, heading style, and terminology, then translate the entire document.
{% endstep %}

{% step %}
### 3. Perform Separate OCR Checks for Images

After uploading screenshots, first verify the recognized text, especially numbers, button names, and tables. Correct recognition errors before translation.
{% endstep %}

{% step %}
### 4. Have the Agent Perform Consistency Checks

Place the source text, translation, and glossary in the working directory, and have the Agent list terminology inconsistencies, missing translations, number discrepancies, and link issues. Do not directly replace legal content.
{% endstep %}
{% endstepper %}

## Pre-Delivery Checklist

* Product names and UI paths match the actual interface;
* Numbers, dates, currencies, and units remain unchanged;
* Markdown links, code blocks, and image captions are preserved;
* Legal, medical, or safety content has been professionally reviewed.

## Recommended Combinations and Completion Criteria

| Item | Recommended Approach |
| ---- | --------------------------------- |
| Translation Entry | Use [Translation] for short texts and screenshots; assign multi-file organization to the Agent |
| Terminology | Provide product names, proper nouns, and a list of non-translatable terms first |
| Files | Save source and translated files in separate directories, maintaining the original filename correspondence |
| Completion Criteria | Numbers, links, and proper nouns are consistent; image text has been spot-checked; layout changes are marked in the delivery notes |

{% hint style="warning" %}
History is convenient for reuse but also stores translation content. After handling sensitive materials, check and clean up records according to your data management requirements.
{% endhint %}
