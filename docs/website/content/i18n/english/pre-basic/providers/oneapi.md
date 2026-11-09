# OneAPI

*   Log in and go to the token page

<figure><img src="../../../../assets/68288a2c3a095035189e8d25.webp" alt=""><figcaption></figcaption></figure>

*   Create a new token (you can also use the default token directly ↑)

<figure><img src="../../../../assets/b52ed2463a5c1ea3de393a3e.webp" alt="" width="563"><figcaption></figcaption></figure>

*   Copy the token

<figure><img src="../../../../assets/e485ab0dd933dd974e8648e3.webp" alt="" width="563"><figcaption></figcaption></figure>

*   Open CherryStudio's service provider settings and click `Add` at the bottom of the service provider list.
*   Enter a remark name, select OpenAI as the provider, and click Confirm.

<figure><img src="../../../../assets/50df1585fd248479a6cb76c5.webp" alt="" width="291"><figcaption></figcaption></figure>

*   Fill in the key you just copied.
*   Go back to the API Key acquisition page, and copy the root address from the corresponding browser's address bar, e.g.:

<figure><img src="../../../../assets/15e84703b85e9e47c3de65e4.webp" alt="" width="563"><figcaption><p><strong>Only copy https://xxx.xxx.com; the "/" and anything after it are not needed.</strong></p></figcaption></figure>

{% hint style="info" %}
*   When the address is IP+Port, just fill in http://IP:Port, e.g., http://127.0.0.1:3000
*   Strictly distinguish between `http` and `https`; if SSL is not enabled, do not use `https`.
{% endhint %}

*   Add a model (click Sync models to fetch them automatically, or + to enter one manually) and turn on the switch in the upper right corner to use it.

{% hint style="success" %}
Other OneAPI themes might have different interfaces, but the adding method is consistent with the process described above.
{% endhint %}