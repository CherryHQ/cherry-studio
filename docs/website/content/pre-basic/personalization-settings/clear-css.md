---
icon: trash-xmark
---

# 清除 CSS 设置

{% hint style="warning" %}
当设置了错误的 css，或者在设置了 css 后无法进入设置界面时，使用该方法清除 css 设置。
{% endhint %}

* 打开控制台，点击 CherryStudio 窗口，按下快捷键<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>（MacOS：<kbd>command</kbd>+<kbd>option</kbd>+<kbd>I</kbd>）。
* 在弹出的控制台窗口中，点击 `Console`

<figure><img src="../../assets/64827e5178c569e716f679aa.webp" alt=""><figcaption></figcaption></figure>

* 然后手动输入 `document.getElementById('user-defined-custom-css').remove()` ，复制粘贴大概率不会执行。
* 输入完成后回车确认即可清除 css 设置，然后再次进入 CherryStudio 的【外观】设置当中，删除有问题的 css 代码。

***

### 💡 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
