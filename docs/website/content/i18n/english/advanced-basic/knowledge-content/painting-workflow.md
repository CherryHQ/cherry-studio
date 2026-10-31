---
icon: palette
---
# Image Generation, Editing, and Enhancement

**Painting** can generate images from text, use reference images, edit specific regions, merge multiple images, reuse templates, and enhance resolution. First, determine the intended use of the image, then choose the appropriate generation or editing method.

## Choosing the Right Starting Point

| Requirement | Recommended Approach |
| ------------ | ------------ |
| Create a visual direction from scratch | Text-to-image or templates |
| Keep the subject, change the background or style | Upload a reference image and edit |
| Modify only a part of the image | Use a mask to mark the modification area |
| Combine multiple assets into one image | Multi-image merge, specifying primary and secondary relationships |
| Existing image needs to be clearer | Use enhancement/upscaling features |

### Example: From a Description to a Finished Product

Open **Painting**, select an image model that supports the current task, input the subject, environment, style, lighting, composition, and constraints, then send. An example prompt is:

> A creative workspace in morning light, cherry-red desk lamp, sketchbook, camera, and a branch of cherry blossoms, with quiet mountains outside the window; soft 3D illustration style, warm morning light, wide composition, no text.

1. Clearly state the purpose and composition, then select a painting model.
2. Generate the first version, checking the subject, edges, and dimensions.
3. If it is not yet usable, modify only one aspect, regenerate, and check again.
4. Once confirmed usable, zoom in to inspect and export.

{% hint style="info" %}
The example uses **GPT-Image-2 | express** to generate a wide workspace illustration. Models, dimensions, and available actions depend on what is displayed on your current page; do not copy parameters you cannot see.
{% endhint %}

Do not leave immediately after generation: first zoom in to check the subject, edges, and extraneous elements, then switch versions from the history on the left. When adjustments are needed, keep the effective descriptions and modify only one aspect.

<figure><img src="../../../../assets/b51ef44b212ce6e8aa7962a8.webp" alt="The Paintings page with history thumbnails on the left, the generated image in the center and zoom tools beside it"><figcaption><p>① History thumbnails for this generation are kept on the left; ② The full finished product is displayed in the center; ③ Zoom in to inspect before downloading, copying, or continuing to edit. </p></figcaption></figure>

## Completing a Usable Image

{% stepper %}
{% step %}
### 1. Select Model and Mode

Different image models support different dimensions, reference images, and editing capabilities. Do not force-fill parameters that are not displayed on the page based on experience.
{% endstep %}

{% step %}
### 2. Clearly State Purpose and Composition

Specify the subject, environment, perspective, color tone, aspect ratio, whitespace, and content that should not appear. When adding titles, it is usually better to have the model leave whitespace and add text using design tools.
{% endstep %}

{% step %}
### 3. Verify One Direction at a Time

First generate a small batch of results, select the closest image, then edit or enhance it. Generating multiple images simultaneously increases usage and makes it harder to determine which requirement is effective.
{% endstep %}

{% step %}
### 4. Inspect Details Before Exporting

Zoom in to check human hands, product structures, text, brand logos, and edges. For commercial use, confirm the source of assets and the corresponding terms of service.
{% endstep %}
{% endstepper %}

### Drawing in Agent

First go to **Settings** → **Default Models** to select the **Painting Model**, then open the Agent's **Built-in Tools** to confirm that **Generate Image** is enabled. After that, you can instruct the Agent in **Work** to read articles, refine the visual direction, and directly generate accompanying images.

<figure><img src="../../../../assets/daa7cbd0f1b2f4f701a0c0e0.webp" alt="Drawing model selection in default model settings"><figcaption><p>The <strong>Painting Model</strong> in <strong>Default Models</strong> determines which model the Agent and related painting entry points prioritize. </p></figcaption></figure>

### Application Case: Creating a Set of Brand Campaign Images

First, establish unified color tones, camera angles, and whitespace rules in a template, then generate a horizontal header image. After selecting the direction, use the same reference image to create square social media images and vertical story images. If product appearances are inconsistent, use local editing to correct them, and finally enhance the versions intended for distribution. Throughout the process, do not let the model generate brand text to avoid typos and distortions.

{% hint style="warning" %}
Reference images may be sent to the selected model service. Before uploading client materials, portraits, and unpublished product images, confirm the scope of services permitted for use.
{% endhint %}
