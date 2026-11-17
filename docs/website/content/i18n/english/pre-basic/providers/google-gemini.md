# Google Gemini

## Get API Key

*   Before getting a Gemini API key, you need a Google Cloud project (if you already have one, you can skip this step)
*   Go to [Google Cloud](https://console.cloud.google.com/projectcreate) to create a project, fill in the project name, and click "Create"

<figure><img src="../../../../assets/d86dd3dba06b0356cfa41da9.webp" alt="The New Project page in Google Cloud"><figcaption></figcaption></figure>

*   On the [Google AI Studio API Keys page](https://aistudio.google.com/app/apikey), create a new key. In the **Create a new key** dialog, name the key, then under **Select an import project** choose the project you just created (or use **Import Project** / **Create a project**)

<figure><img src="../../../../assets/477093fbb27b27b67f9bef5f.webp" alt="The Create a new key dialog in Google AI Studio with the project dropdown open"><figcaption><p>Choose the Google Cloud project for the new key</p></figcaption></figure>

*   Copy the generated key and open CherryStudio's [Service Provider Settings](../../pre-basic/settings/providers.md)
*   Find the provider Gemini, click **Add API key**, paste the key you just obtained, then click **Save and close**

<figure><img src="../../../../assets/e284650b1e470789c7924ab0.webp" alt="The Add API key dialog for Gemini"><figcaption><p>Add API key dialog</p></figcaption></figure>

*   Click "Sync models" (or "+" to add one manually) next to the Models heading to add supported models, then turn on the service provider switch in the upper right corner to start using it.

{% hint style="info" %}
- Google Gemini services are not directly available in China (excluding Taiwan); you need to resolve proxy issues yourself.
{% endhint %}