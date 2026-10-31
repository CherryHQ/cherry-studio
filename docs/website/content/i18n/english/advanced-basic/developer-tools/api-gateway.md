---
icon: bridge
---
# API Gateway

The API Gateway exposes the model capabilities configured in Cherry Studio to local programs via OpenAI and Anthropic-compatible HTTP APIs. It also serves as the internal service required for Agent execution.

Path: [Settings] → [API Gateway].

## Distinguish Between Agent Usage and External Calls

*   Using only the Cherry Studio Agent: Follow the app prompt to [Enable and Start]. You do not need to copy the URL or API key to other programs.
*   Local programs need to call Cherry Studio: Start the gateway, copy the URL and API key, and select the compatible interface according to the API documentation.
*   Access from other devices: This expands the exposure scope. You must verify network listening, firewall, and access control settings yourself. It is not recommended to open access without security measures.

## Start and Connect

{% stepper %}
{% step %}
### 1. Check the Port

You can modify the port when the gateway is stopped. Select a port not occupied by other programs; the service will not start properly if there is a port conflict.
{% endstep %}

{% step %}
### 2. Start the Gateway

Click [Start]. Once the status changes to [Running], the page will display the available URL and provide an entry point to the [API Documentation].
{% endstep %}

{% step %}
### 3. Configure Authorization

External programs use `Authorization: Bearer <API Key>`. You can copy the authorization header directly from the page. Do not write the key into code repositories or screenshots.
{% endstep %}

{% step %}
### 4. Verify with a Minimal Request

First, request the model list or send a short text according to the API documentation, then integrate the full application. If errors occur, record the HTTP status and response, but do not expose the full authorization header.
{% endstep %}
{% endstepper %}

## Use Case: Calling Models from Local Scripts

First, confirm that the model can converse normally in [Settings] → [Model Provider], then start the API Gateway. The script should only store the local gateway address and key. Start by requesting the model list, then send a short text. Before integrating the full program, ensure the client supports OpenAI or Anthropic-compatible interfaces.

| Configuration | Recommended Start | Purpose | Notes |
| ------ | ---------- | --------- | ----------------- |
| Listening Scope | Local use only | Reduce network exposure | Do not open to LAN or public internet just for debugging convenience |
| API Key | Store separately for the current gateway | Verify client requests | Do not write to repositories, screenshots, or shared logs |
| Verification Request | Check model list and short text first | Verify connection and generation separately | Record status codes on failure; do not record the full key |

### Completion Criteria

The gateway displays [Running]; the model list is readable; short text requests succeed; and clients cannot continue calling after the gateway is stopped.

## Security Operations

{% hint style="danger" %}
The API key can invoke the model services you have configured in Cherry Studio. If the key is leaked, stop the gateway first, click [Regenerate] while it is stopped, and then update all local clients.
{% endhint %}

*   The port and key are read-only while the gateway is running; stop it before making changes.
*   Do not display the key in public repositories, Issues, logs, or tutorial screenshots.
*   Only store the key in programs that need to make calls.
*   Usage and costs are incurred by the actual model provider. You can view Cherry Studio records in [Settings] → [Usage Statistics].

<details>

<summary>What is the relationship between the API Gateway and Model Services? </summary>

Model Services store the connections to upstream providers; the API Gateway converts these capabilities into compatible interfaces. The gateway itself does not provide models; it still requires at least one available provider and model.

</details>

<details>

<summary>The port is normal, but the client returns an unauthorized error. What should I do? </summary>

Ensure the request header is `Authorization: Bearer ...`, with no extra quotes or spaces, and check if the key used by the client is still the current value on the page.

</details>
