# References and text

Fixed sample data for OpenUI POC verification.

```openui
root = Panel("Incident handoff", [intro, status, events])
intro = Text("Owner: Ada\nNext update: 14:30 UTC\nQuotes: \"all clear\"; path: C:\\logs\\release")
status = Metric("Customer impact", 0, "No active customer incidents")
events = DataTable(["Time", "Event", "Owner"], [["14:05", "Rollback completed", "Ada"], ["14:12", "Health checks passed", "Lin"], ["14:30", "Next update", "Mina"]])
```
