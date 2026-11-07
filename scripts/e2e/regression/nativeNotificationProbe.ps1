param([string]$Text)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted runner required' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NotificationProbe {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string kind,string name);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle,out uint owner);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr handle,StringBuilder value,int length);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle,StringBuilder value,int length);
}
'@
$handles = @(
 @{source='foreground';handle=[NotificationProbe]::GetForegroundWindow()},
 @{source='find-action';handle=[NotificationProbe]::FindWindow('Windows.UI.Core.CoreWindow','Action center')},
 @{source='find-notification';handle=[NotificationProbe]::FindWindow('Windows.UI.Core.CoreWindow','Notification center')}
)
$windows = foreach ($candidate in $handles) {
 $handle=$candidate.handle
 $owner=0
 [NotificationProbe]::GetWindowThreadProcessId($handle,[ref]$owner) | Out-Null
 $kind=[Text.StringBuilder]::new(256)
 $caption=[Text.StringBuilder]::new(512)
 [NotificationProbe]::GetClassName($handle,$kind,$kind.Capacity) | Out-Null
 [NotificationProbe]::GetWindowText($handle,$caption,$caption.Capacity) | Out-Null
 $processName=if($owner){(Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName}else{''}
 $record=[ordered]@{source=$candidate.source;handle=$handle.ToInt64();owner=$owner;process=$processName;class=$kind.ToString();visible=[NotificationProbe]::IsWindowVisible($handle);captionMatches=($caption.ToString() -match '^(Action center|Notification center)$')}
 if($record.visible -and $record.captionMatches -and $processName -eq 'ShellExperienceHost') {
  $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
  $record['controls']=@($root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
   [pscustomobject]@{type=$_.Current.ControlType.ProgrammaticName;class=$_.Current.ClassName;id=$_.Current.AutomationId;offscreen=$_.Current.IsOffscreen;nameLength=$_.Current.Name.Length;matches=$_.Current.Name.Contains($Text)}
  })
 }
 [pscustomobject]$record
}
$history=$null
try {
 $manager=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]
 $items=@($manager::History.GetHistory('com.kangfenmao.CherryStudio'))
 $history=[pscustomobject]@{count=$items.Count;matches=@($items|Where-Object {$_.Content.GetXml().Contains($Text)}).Count}
} catch { $history=[pscustomobject]@{error=$_.Exception.Message} }
[pscustomobject]@{windows=$windows;history=$history} | ConvertTo-Json -Depth 8 -Compress
