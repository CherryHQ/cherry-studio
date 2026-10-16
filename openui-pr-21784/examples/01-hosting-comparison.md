# Hosting comparison

Fixed sample data for OpenUI POC verification.

```openui
root = Panel("Choose a deployment plan", [Text("Compare sample plans by cost, capacity, and operating effort."), DataTable(["Plan", "Monthly cost", "Capacity", "Best fit"], [["Local", "$0", "Your hardware", "Private experiments"], ["Starter", "$19", "2 vCPU / 4 GB", "Personal projects"], ["Team", "$79", "4 vCPU / 16 GB", "Shared workspace"], ["Scale", "$249", "8 vCPU / 32 GB", "High traffic"]]), Metric("Lowest monthly cost", 0, "Local plan; hardware and power costs excluded")])
```
