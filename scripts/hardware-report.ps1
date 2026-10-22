# scripts/hardware-report.ps1 - L0.1 (v8.2 plan)
# Collects the hardware facts the model-configuration decisions depend on:
# DIMM population/speeds, power plan, CPU capability class, RAM/disk headroom,
# timezone and clock drift. Output: docs/hardware-report.md
# Run from the app root:  powershell -ExecutionPolicy Bypass -File scripts\hardware-report.ps1
$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]
$warns = New-Object System.Collections.Generic.List[string]
$add = { $lines.Add($args[0]) }

# --- CPU ---
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$vThreads = $cpu.NumberOfLogicalProcessors
$pCores = $cpu.NumberOfCoresMHz
$pCores = $cpu.NumberOfCores
& $add "## CPU"
& $add "- Model: $($cpu.Name.Trim())"
& $add "- Physical cores: $($cpu.NumberOfCores) / Logical: $vThreads"
& $add "- Base clock (reported): $($cpu.MaxClockSpeed) MHz; current: $($cpu.CurrentClockSpeed) MHz"
& $add "- L3 cache: $([math]::Round($cpu.L3CacheSize/1MB,1)) MB"
& $add "- Generation class: (derived) Haswell-EP or newer => AVX2/FMA-capable per Intel ARK; verify at runtime with coreinfo -v if wanted"

if ($cpu.CurrentClockSpeed -lt $cpu.MaxClockSpeed * 0.5) {
  $warns.Add("CPU idling far below base clock ($($cpu.CurrentClockSpeed) vs $($cpu.MaxClockSpeed) MHz) - check the power plan below.")
}

# --- Memory population (the bandwidth story) ---
$dimms = Get-CimInstance Win32_PhysicalMemory
$slotsTotal = (Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1).MemoryDevices
$installedChannels = @()
& $add ""
& $add "## Memory (DIMMs)"
foreach ($d in $dimms) {
  $gb = [math]::Round($d.Capacity/1GB,0)
  & $add "- Slot $($d.DeviceLocator): $gb GB @ $($d.Speed) MT/s (configured $($d.ConfiguredClockSpeed) MT/s), form factor $($d.FormFactor)"
  $installedChannels += $d.DeviceLocator
}
$totalGb = [math]::Round(($dimms | Measure-Object -Property Capacity -Sum).Sum/1GB,0)
$dimmCount = @($dimms).Count
& $add "- Total installed: $totalGb GB in $dimmCount of $slotsTotal slots"
$os = Get-CimInstance Win32_OperatingSystem
$freeRamGb = [math]::Round($os.FreePhysicalMemory/1MB,1)
$usedRamGb = [math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,1)
& $add "- In use: $usedRamGb GB / free: $freeRamGb GB"

# Quad-channel arithmetic: 4 slots populated = full bandwidth; 2 = half.
if ($dimms.Count -le 2 -and $slotsTotal -ge 4) {
  $warns.Add("Only $dimmCount of $slotsTotal memory channels populated - expect roughly half the theoretical bandwidth. Models will run noticeably slower; populate the remaining channels for a large speed win.")
} elseif ($dimms.Count -lt $slotsTotal) {
  $dimmCount = @($dimms).Count
  $warns.Add("Memory channels are not fully populated ($dimmCount/$slotsTotal).")
}

# --- Power plan (L0.1 warning requirement) ---
& $add ""
& $add "## Power plan"
$plan = powercfg /getactivescheme 2>$null
& $add "- Active: $plan"
if ($plan -match 'Balanced') { $warns.Add("Power plan is Balanced - set High Performance so the CPU does not throttle between inferences.") }

# --- Disks ---
& $add ""
& $add "## Disks"
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  $freePct = if ($_.Size) { [math]::Round($_.FreeSpace/$_.Size*100,1) } else { 0 }
  & $add "- $($_.DeviceID) $([math]::Round($_.Size/1GB,0)) GB total, $freePct% free"
  if ($freePct -lt 15) { $warns.Add("Drive $($_.DeviceID) has only $freePct% free - under the Doctor's 15% floor.") }
}

# --- Time + uptime ---
& $add ""
& $add "## Time & uptime"
& $add "- Time zone: $((Get-TimeZone).Id) | Local time: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
if ((Get-TimeZone).Id -notmatch 'Cairo|Egypt') { $warns.Add("Time zone is not Cairo/Egypt; ETA appointment logic assumes Cairo.") }
$lastBoot = $os.LastBootUpTime
& $add "- Last boot: $lastBoot"
$clockSkew = if ($os.LocalDateTime) { [math]::Abs(($os.LocalDateTime - (Get-Date)).TotalSeconds) } else { 0 }
& $add "- Clock skew (WMI vs Get-Date): $([math]::Round($clockSkew,1)) s"

# --- Summary ---
& $add ""
& $add "## Warnings"
if ($warns.Count -eq 0) { & $add "- none" } else { foreach ($w in $warns) { & $add "- [WARN] $w" } }

$dir = Join-Path (Get-Location) 'docs'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$header = "# Hardware report ($((Get-Date).ToString('yyyy-MM-dd HH:mm'))) - task L0.1`n`n"
$out = Join-Path $dir 'hardware-report.md'
$header + ($lines -join "`r`n") | Set-Content -Path $out -Encoding utf8
Write-Output "Wrote $out"
foreach ($w in $warns) { Write-Output "WARN: $w" }
