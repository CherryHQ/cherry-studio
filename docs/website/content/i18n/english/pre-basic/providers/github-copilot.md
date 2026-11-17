# GitHub Copilot

To use GitHub Copilot, you need to have a GitHub account and subscribe to the GitHub Copilot service. A free subscription is also acceptable, but the free version does not support the latest Claude 3.7 model. For details, please refer to the [official GitHub Copilot website](https://github.com/features/copilot).

## Obtain Device Code

On the GitHub Copilot provider page, follow the three steps: **Get Authorization Code**, **Copy Authorization Code** (it is copied automatically; you can also click **Copy**), then **Open Authorization Page**.

<figure><img src="../../../../assets/49532cb75971bca02aed52c1.webp" alt="GitHub Copilot provider page showing the Get, Copy and Open Authorization Page steps"><figcaption><p>Get and copy the authorization code, then open the authorization page</p></figcaption></figure>

## Enter Device Code in Browser and Authorize

After successfully obtaining the Device Code, click the link to open your browser, log in to your GitHub account in the browser, enter the Device Code, and authorize.

<figure><img src="../../../../assets/1bf59331d4a2754ff20e7379.webp" alt="Example image for GitHub authorization"><figcaption><p>GitHub Authorization</p></figcaption></figure>

After authorizing, return to Cherry Studio. Once connected, your GitHub username and avatar are shown on the provider page, with an **Exit GitHub** button to sign out.

<figure><img src="../../../../assets/295c359b92931dfa1ea17104.webp" alt="GitHub Copilot provider page showing the connected GitHub account and the Exit GitHub button"><figcaption><p>GitHub Connection Successful</p></figcaption></figure>

## Click "Sync models" to Get the Model List

Click "Sync models" to automatically retrieve the list of currently supported models online.

<figure><img src="../../../../assets/d1fa7890e975751f3e553336.webp" alt="GitHub Copilot model list opened from Sync models"><figcaption><p>Sync models lists the models available with your Copilot subscription; click + to add them</p></figcaption></figure>

## Frequently Asked Questions

### Failed to Obtain Device Code, Please Retry

Currently, requests are built using Axios, which does not support SOCKS proxies. Please use a system proxy or HTTP proxy, or do not set a proxy directly in CherryStudio and use a global proxy instead. First, please ensure your network connection is normal to avoid failures in obtaining the Device Code.