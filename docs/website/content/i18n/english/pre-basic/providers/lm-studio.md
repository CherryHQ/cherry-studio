# LM Studio

LM Studio is a popular **local LLM GUI** that supports downloading, quantizing, and running inference for various open-source models locally. Cherry Studio can connect to LM Studio's local service as a frontend, providing a better conversational experience while maintaining local privacy.

## Prerequisites

1. Download and install the client from the [LM Studio official website](https://lmstudio.ai/)
2. Download at least one model in LM Studio (recommended to try Llama 3.x 8B or Qwen series first)
3. Open the **Server** tab at the top of LM Studio and click **Start Server** (default port `1234`)

## Configure in Cherry Studio

* Open `Settings → Model Provider`, find the **LM Studio** Provider, and enter the details page
* The **API Address** defaults to `http://localhost:1234`. If you have changed the LM Studio port, update this accordingly
* The **API Key** can be left empty (local inference requires no authentication), or filled in if you enable authentication in LM Studio
* Click **Fetch Model List**, and Cherry Studio will automatically retrieve the models loaded in LM Studio

{% hint style="info" %}
**Model list is empty?** LM Studio only exposes models that are **`Load` into memory**. Models that are not loaded will not appear in the list. Go back to LM Studio, load a model first, and then click "Fetch Model List" again.
{% endhint %}

## Recommended Usage

| Scenario | Recommendation |
| -------------------- | --------------------------------------------------------------------- |
| Privacy-sensitive conversations | Use small models (under 8B) locally for fully offline operation |
| Apple Silicon (M-series chips) | Use the MLX backend in LM Studio for significantly higher efficiency than llama.cpp |
| Embedding models | LM Studio can also load embedding models for knowledge bases |

## Differences from Ollama

| | LM Studio | [Ollama](ollama.md) |
| ---- | ------------- | ------------------- |
| Form | GUI + Server | Command line / Background service |
| Model Management | GUI browse/download | `ollama pull` |
| API | OpenAI compatible | OpenAI compatible |
| Best For | Users who prefer graphical interaction | Users who prefer command line / Docker deployment |

Both can be integrated with Cherry Studio. Choose based on your personal preference.

## FAQ

* **Cherry Studio cannot connect**: Ensure the Server in LM Studio is started (green dot status)
* **Response is very slow**: The model is too large or there is insufficient VRAM. Switch to a smaller model or a lower quantization (e.g., Q4 → Q3)
* **Garbled text / truncated output**: The context length exceeds the model's limit. Increase `n_ctx` in LM Studio

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature improvement suggestions during configuration or usage, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
