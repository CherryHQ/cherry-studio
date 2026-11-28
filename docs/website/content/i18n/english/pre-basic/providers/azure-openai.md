# Azure OpenAI

Azure OpenAI is the OpenAI model service hosted by Microsoft on Azure, suitable for teams requiring enterprise compliance, data residency commitments, or integration with the Microsoft ecosystem.

## Prerequisites

* An active Azure subscription
* Access approval for Azure OpenAI Service obtained via Azure Portal
* At least one **Resource** and **Deployment** created

## Obtain API Key

* Azure Portal → Your Azure OpenAI resource → `Keys and Endpoint`
* Copy `KEY 1` or `KEY 2`, and note down `Endpoint` (formatted as `https://<your-name>.openai.azure.com/`)

## Configure in Cherry Studio

* Open `Settings → Model Provider`, locate the **Azure OpenAI** Provider, and enter the details page
* **API Key**: Enter the copied KEY
* **API Endpoint**: Enter the resource Endpoint (without the trailing path)
* **API Version**: Enter the API version of your deployment in the dedicated field (e.g., `2024-08-01-preview`)
* Click **Fetch Model List**, or manually add the model names you have deployed on Azure (i.e., the Deployment Name, not the original OpenAI model ID)

{% hint style="warning" %}
**Deployment Name vs Model ID**: Azure uses the name you assigned to the deployment (e.g., `gpt-4o-prod`), not the original ID like `gpt-4o`. Incorrect entries will result in a 404 error.
{% endhint %}

## Recommended Usage

* **gpt-4o / gpt-4o-mini**: General conversation, Agent
* **gpt-4 turbo**: Long context
* **text-embedding-3-**\*: Embedding models, usable for knowledge bases

## FAQ

* **401 Unauthorized**: Verify the Key is correct and check for unnecessary trailing slashes in the Endpoint
* **404 Not Found**: Verify the Deployment Name matches Azure exactly and that the API Version is filled in
* **429 Throttled**: Check Azure quotas (Quota & Limits page)

***

### Get Help and Submit Feedback

If you have any questions, encounter bugs, or have feature improvement suggestions during configuration or usage, please refer to the official channels provided in [Feedback and Suggestions](../../question-contact/suggestions.md).
