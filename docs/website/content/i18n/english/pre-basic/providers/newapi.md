# NewAPI

* Log in to your NewAPI instance, create a token on its token page, and copy it
* Open Cherry Studio's Provider Settings and click 'Add' at the bottom of the provider list
* Enter a remark name, select OpenAI as the provider, and click "OK"

<figure><img src="../../../../assets/50df1585fd248479a6cb76c5.webp" alt="" width="291"><figcaption></figcaption></figure>

* Fill in the key you just copied
* Go back to the API Key acquisition page, copy the root address from the browser's address bar, e.g.:

<figure><img src="../../../../assets/4ce2f68c18ea7574a2f7db4b.webp" alt=""><figcaption><p><strong>Only copy https://xxx.xxx.com; content after "/" is not needed</strong></p></figcaption></figure>

{% hint style="info" %}
* When the address is IP+Port, simply fill in http://IP:Port, e.g., http://127.0.0.1:3000
* Strictly distinguish between `http` and `https`; if SSL is not enabled, do not fill in https
{% endhint %}

* Add models (click "Sync models" to fetch them automatically, or "+" to enter one manually). Turn on the switch in the upper right corner to use.