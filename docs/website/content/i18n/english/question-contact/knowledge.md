---
icon: book-bookmark
---
# Knowledge Popularization

## What are tokens?

Tokens are the basic units that AI models use to process text, which can be understood as the smallest units of a model's "thought." They are not entirely equivalent to characters or words as we understand them, but rather a special text segmentation method used by the model itself.

#### 1. Chinese Word Segmentation

* A Chinese character is usually encoded as 1-2 tokens.
* For example: `"Hello"` ≈ 2-4 tokens

#### 2. English Word Segmentation

* Common words are usually 1 token.
* Longer or less common words are broken down into multiple tokens.
* For example:
  * `"hello"` = 1 token
  * `"indescribable"` = 4 tokens

#### 3. Special Characters

* Spaces, punctuation marks, etc., also occupy tokens.
* A newline character is usually 1 token.

{% hint style="info" %}
The Tokenizer for different service providers varies, and even within the same service provider, different models may have different Tokenizers. This knowledge is only intended to clarify the concept of tokens.
{% endhint %}

***

## What is a Tokenizer?

A Tokenizer is a tool that AI models use to convert text into tokens. It determines how input text is segmented into the smallest units that the model can understand.

### Why are Tokenizers different for different models?

#### 1. Different Training Data

* Different corpora lead to different optimization directions.
* Varying degrees of multilingual support.
* Specific optimizations for specialized domains (medical, legal, etc.).

#### 2. Different Tokenization Algorithms

* BPE (Byte Pair Encoding) - OpenAI GPT series
* WordPiece - Google BERT
* SentencePiece - suitable for multilingual scenarios

#### 3. Different Optimization Goals

* Some focus on compression efficiency.
* Some focus on semantic preservation.
* Some focus on processing speed.

### Practical Impact

The same text might have a different number of tokens in different models:

```
Input: "Hello, world!"
GPT-3: 4 tokens
BERT: 3 tokens
Claude: 3 tokens
```

***

## What is an Embedding Model?

**Basic Concept:** An embedding model is a technique that transforms high-dimensional discrete data (such as text, images) into low-dimensional continuous vectors. This transformation allows machines to better understand and process complex data. Imagine simplifying a complex jigsaw puzzle into a simple coordinate point, but this point still retains the key features of the puzzle. In the large model ecosystem, it acts as a "translator," converting human-understandable information into a numerical format that AI can compute.

**Working Principle:** Taking natural language processing as an example, an embedding model can map words to specific positions in a vector space. In this space, words with similar meanings automatically cluster together. For instance:

* Vectors for "king" and "queen" will be very close.
* Pet words like "cat" and "dog" will also be close.
* Words with unrelated meanings, like "car" and "bread," will be far apart.

**Main Application Scenarios:**

* Text Analysis: Document classification, sentiment analysis.
* Recommendation Systems: Personalized content recommendations.
* Image Processing: Similar image retrieval.
* Search Engines: Semantic search optimization.

**Core Advantages:**

1.  **Dimensionality Reduction:** Simplifies complex data into an easy-to-process vector format.
2.  **Semantic Preservation:** Retains crucial semantic information from the original data.
3.  **Computational Efficiency:** Significantly improves the training and inference efficiency of machine learning models.

**Technical Value:** Embedding models are fundamental components of modern AI systems, providing high-quality data representations for machine learning tasks and driving the development of fields such as natural language processing and computer vision.

***

## How Embedding Models Work in Knowledge Retrieval

**Basic Workflow:**

1.  **Knowledge Base Preprocessing Phase**

    *   Divide documents into appropriate-sized chunks (text blocks).
    *   Use an embedding model to convert each chunk into a vector.
    *   Store the vectors and original text in a vector database.

2.  **Query Processing Phase**

    *   Convert the user's question into a vector.
    *   Retrieve similar content from the vector database.
    *   Provide the retrieved relevant content as context to the LLM.

***

<a id="shen-me-shi-mcpmodel-context-protocol"></a>

## **What is MCP (Model Context Protocol)?**

MCP is an open-source protocol designed to provide context information to large language models (LLMs) in a standardized way.

*   **Analogical Understanding:** You can think of MCP as the "USB drive" of the AI world. We know that a USB drive can store various files and can be used directly after plugging it into a computer. Similarly, an MCP Server can have various context-providing "plugins" connected to it. LLMs can request these plugins from the MCP Server as needed, thereby obtaining richer context information and enhancing their capabilities.
*   **Comparison with Function Tool:** Traditional Function Tools can also provide external functionality to LLMs, but MCP is more like a higher-dimensional abstraction. Function Tools are more focused on specific task-oriented tools, while MCP provides a more general, modular mechanism for acquiring context.

### **Core Advantages of MCP**

1.  **Standardization:** MCP provides a unified interface and data format, enabling seamless collaboration between different LLMs and context providers.
2.  **Modularity:** MCP allows developers to break down context information into independent modules (plugins), making management and reuse easier.
3.  **Flexibility:** LLMs can dynamically select required context plugins based on their own needs, achieving more intelligent and personalized interactions.
4.  **Extensibility:** MCP's design supports adding more types of context plugins in the future, offering infinite possibilities for expanding LLM capabilities.

***