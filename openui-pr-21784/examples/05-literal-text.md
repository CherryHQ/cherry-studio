# Literal text and values

Fixed sample data for OpenUI POC verification.

```openui
root = Panel("Content boundary check", [Text("<script>window.__openUiExecuted = true</script>\n<img src=x onerror=\"window.__openUiExecuted = true\">\n**Markdown stays literal**"), DataTable(["Input", "Value", "Expected presentation"], [["Zero", 0, "Visible numeric cell"], ["Negative", -42.75, "Visible numeric cell"], ["Quoted text", "He said \"ready\"", "Literal text"], ["HTML-like text", "<b>not bold</b>", "Literal text"], ["Empty cell", "", "Empty cell retained"]]), Metric("Zero is a value", 0, "The metric must remain visible")])
```
