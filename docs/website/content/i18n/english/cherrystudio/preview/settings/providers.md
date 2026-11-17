---
icon: cloud-check
---
# Model Service Settings

This page only introduces the interface functions. For configuration tutorials, please refer to the [Provider Configuration](../../../pre-basic/providers/) tutorial in the basic tutorials.

{% hint style="info" %}
*   When using a built-in provider, you only need to fill in the corresponding secret key.
*   Different providers may call the secret key by different names, such as Key, API Key, or Token, but they all refer to the same thing.
{% endhint %}

### API Key

To enter a key, click **Add API key** in the API Key field. In the dialog, paste the key, then click **Save and close** (or **Next** to continue setting up). Click **Get API Key** next to the field title to open the provider's key page.

<figure><img src="../../../../../assets/dcacb5e593a9740371d6dc50.webp" alt="The Add API key dialog for OpenAI with an Enter API key field and Save and close / Next buttons"><figcaption><p>The Add API key dialog</p></figcaption></figure>

In Cherry Studio, a single provider supports multi-key round-robin usage, where keys are used in a sequential, looping manner from front to back.

*   Add multiple keys separated by English commas, as shown in the example below:

<pre><code><strong>sk-xxxx1,sk-xxxx2,sk-xxxx3,sk-xxxx4
</strong></code></pre>

{% hint style="warning" %}
You must use **English** commas.
{% endhint %}

<a id="api-di-zhi"></a>

### API Host

When using a built-in provider, you generally do not need to fill in the API Host. If you need to modify it, please strictly follow the address provided in the official documentation.

> If the address provided by the provider is in the format <mark style="background-color:red;">https://xxx.xxx.com</mark><mark style="background-color:green;">/v1/chat/completions</mark>, you only need to fill in the root address part (<mark style="background-color:red;">https://xxx.xxx.com</mark>).
>
> Cherry Studio will automatically append the remaining path (<mark style="background-color:green;">/v1/chat/completions</mark>). Failure to fill it in correctly may result in abnormal usage.

{% hint style="info" %}
Note: The large language model routing for most providers is unified, and generally, the following operations are not required. If the provider's API path is v2, v3/chat/completions, or another version, you can manually enter the corresponding version ending with "`/`" in the address bar; when the provider's request route is not the conventional <mark style="background-color:green;">/v1/chat/completions</mark>, use the complete address provided by the provider and end it with `#`.

That is:

*   When the API address ends with `/`, only "chat/completions" will be appended.
*   When the API address ends with `#`, no appending operation will be performed, and only the entered address will be used.
{% endhint %}

### Adding Models

Click **Sync models** to the right of the **Models** heading to automatically retrieve the models supported by the provider, then add the ones you want to the model list. To add a model by hand, click the **+** next to **Sync models** and fill in the Model ID, Model Name and Group Name.

Each model in the list has a settings icon for editing it and a **−** for removing it.

{% hint style="info" %}
Retrieved models only appear in the model selection list after they have been added to the model list on the provider configuration page.
{% endhint %}

### Connectivity Check

Click **Model Check** to the right of the API Key field to test whether the configuration works.

{% hint style="info" %}
During model checking, the last conversation model added to the model list is used by default. If the check fails, please verify if there are any incorrect or unsupported models in the model list.
{% endhint %}

{% hint style="danger" %}
After successful configuration, be sure to turn on the switch in the upper right corner, otherwise the provider will remain disabled and its corresponding models will not be found in the model list.
{% endhint %}