<#
.SYNOPSIS
  One-shot restore of the dafeiyu-life runtime data directory.

.DESCRIPTION
  Restores a zip produced by backup.ps1. Defaults to dry-run mode (restores into a
  fresh temp dir so you can verify integrity without touching real data). To actually
  write back to the runtime data dir, pass -Into; existing content there is first moved
  to a .bak-<timestamp> unless -Overwrite is given.

.PARAMETER Backup
  Backup zip path. If omitted, the newest backup in BackupDir is used.

.PARAMETER BackupDir
  Backup directory (used when -Backup is omitted).

.PARAMETER Into
  Target directory. Omit for dry-run (restore into a new temp dir).

.PARAMETER Overwrite
  With -Into, overwrite target directly instead of moving it aside first.

.EXAMPLE
  .\scripts\restore.ps1                                   # dry run
  .\scripts\restore.ps1 -Backup .\dafeiyu-life-20261028-120000.zip -Into "$env:USERPROFILE\.dsh\bili-duty"
#>
param(
  [string]$Backup = "",
  [string]$BackupDir = "",
  [string]$Into = "",
  [switch]$Overwrite
)

$ErrorActionPreference = 'Stop'

# ---------- 1. Resolve backup zip ----------
if (-not $Backup) {
  if (-not $BackupDir) {
    $dataDir = if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'bili-duty' } else { Join-Path $HOME '.dsh\bili-duty' }
    $BackupDir = Join-Path (Split-Path $dataDir -Parent) 'dafeiyu-backups'
  }
  $Backup = Get-ChildItem -LiteralPath $BackupDir -Filter 'dafeiyu-life-*.zip' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $Backup) { Write-Error "No backup found in $BackupDir" }
  $Backup = $Backup.FullName
}
if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { Write-Error "Backup file not found: $Backup" }

# ---------- 2. Resolve target directory ----------
$isDryRun = $false
if (-not $Into) {
  $isDryRun = $true
  $Into = Join-Path ([System.IO.Path]::GetTempPath()) ("dafeiyu-restore-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $Into | Out-Null
}

if (Test-Path -LiteralPath $Into) {
  $hasContent = (Get-ChildItem -LiteralPath $Into -Force -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
  if ($hasContent -and -not $Overwrite) {
    $bak = "$Into.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $Into -Destination $bak
    New-Item -ItemType Directory -Force -Path $Into | Out-Null
    Write-Host "Target had content; moved aside to: $bak"
  }
}
else {
  New-Item -ItemType Directory -Force -Path $Into | Out-Null
}

# ---------- 3. Extract ----------
Expand-Archive -LiteralPath $Backup -DestinationPath $Into -Force

# ---------- 4. Verify ----------
$files = (Get-ChildItem -LiteralPath $Into -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count

if ($isDryRun) {
  Write-Host "Dry run done: restored to temp dir $Into ($files file(s)). Verify then delete manually."
}
else {
  Write-Host "Restore done: $Into ($files file(s))"
}
