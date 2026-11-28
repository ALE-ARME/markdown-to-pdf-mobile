param(
    [Parameter(Mandatory = $true)]
    [string]$Target,

    [ValidateSet("separate", "merged")]
    [string]$Mode = "separate",

    [string]$OutputDir = "",
    [string]$OutputName = "",
    [string]$OptionsJson = "",
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

$skillDir = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $skillDir "pdf-export-settings.json"
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json

$vault = $settings.cli.vaultPath
if (-not $vault -or -not (Test-Path -LiteralPath $vault)) {
    throw "Vault path not found: $vault"
}

# Resolve target (exact relative path first, then recursive search by name)
$candidate = Join-Path $vault ($Target -replace '/', '\')
if (Test-Path -LiteralPath $candidate) {
    $item = Get-Item -LiteralPath $candidate
} else {
    $matches = @(Get-ChildItem -LiteralPath $vault -Recurse -Filter "*$Target*" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*.pdf" })
    if ($matches.Count -eq 0) {
        throw "No note or folder matching '$Target' found in $vault"
    }
    if ($matches.Count -gt 1) {
        $exact = @($matches | Where-Object { $_.BaseName -ieq $Target -or $_.Name -ieq $Target })
        if ($exact.Count -eq 1) {
            $item = $exact[0]
        } else {
            Write-Output "MULTIPLE_MATCHES:"
            $matches | ForEach-Object { Write-Output ("- " + $_.FullName.Substring($vault.Length + 1).Replace('\', '/')) }
            exit 2
        }
    } else {
        $item = $matches[0]
    }
}

$relPath = $item.FullName.Substring($vault.Length + 1).Replace('\', '/')
Write-Output "Resolved: $relPath (IsDir: $($item.PSIsContainer))"

# Enable plugin if missing
$cpPath = "$vault\.obsidian\community-plugins.json"
$cp = Get-Content -LiteralPath $cpPath -Raw | ConvertFrom-Json
if ($cp -notcontains "markdown-to-pdf-mobile") {
    $cp += "markdown-to-pdf-mobile"
    [System.IO.File]::WriteAllText($cpPath, ($cp | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "Enabled markdown-to-pdf-mobile in community-plugins.json"
}

# Launch Obsidian detached if not running
if (-not (Get-Process -Name Obsidian -ErrorAction SilentlyContinue)) {
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='"C:\Program Files\Obsidian\Obsidian.exe"'} | Out-Null
    Write-Output "Launched Obsidian, waiting 10s..."
    Start-Sleep -Seconds 10
}

# Merge one-off options in memory (never touches pdf-export-settings.json)
$options = @{}
$settings.options.PSObject.Properties | ForEach-Object { $options[$_.Name] = $_.Value }
if ($OptionsJson) {
    $overrides = $OptionsJson | ConvertFrom-Json
    $overrides.PSObject.Properties | ForEach-Object { $options[$_.Name] = $_.Value }
}

$outDir = if ($OutputDir) { $OutputDir } elseif ($item.PSIsContainer) { "$($settings.cli.defaultOutputDir)/$($item.Name)" } else { $settings.cli.defaultOutputDir }

if ($item.PSIsContainer) {
    $task = @{
        type       = "folder"
        folderPath = $relPath
        mode       = $Mode
        outputDir  = $outDir
    }
} else {
    $outName = if ($OutputName) { $OutputName } else { $item.BaseName }
    $task = @{
        type       = "note"
        notePath   = $relPath
        outputDir  = $outDir
        outputName = $outName
    }
}

$jobId = "agent-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$job = @{
    jobId      = $jobId
    openResult = $false
    options    = $options
    tasks      = @($task)
}

$json = ($job | ConvertTo-Json -Depth 10).Replace([string][char]0x00B0, '\u00b0')
$pluginDir = "$vault\.obsidian\plugins\markdown-to-pdf-mobile"
$jobPath = "$pluginDir\export-job.json"
$resultPath = "$pluginDir\export-result.json"

[System.IO.File]::WriteAllText($jobPath, $json, (New-Object System.Text.UTF8Encoding($false)))

# Trigger Obsidian via URI
$vaultParam = if ($settings.cli.vaultName) { $settings.cli.vaultName } else { (Split-Path -Leaf $vault) }
$uri = "obsidian://mobile-pdf-export?vault=$([uri]::EscapeDataString($vaultParam))&job=default"
$null = (Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine="cmd.exe /c start `"`" `"$uri`""})

# Poll for completion: monitor export-job.json deletion and export-result.json terminal status
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $jobExists = Test-Path -LiteralPath $jobPath

    if (-not $jobExists) {
        if (Test-Path -LiteralPath $resultPath) {
            try {
                $res = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
                if ($res.jobId -eq $jobId) {
                    $res | ConvertTo-Json -Depth 10
                    exit 0
                }
            } catch {}
        }
        [PSCustomObject]@{ jobId = $jobId; status = "completed" } | ConvertTo-Json -Depth 10
        exit 0
    }
    elseif (Test-Path -LiteralPath $resultPath) {
        try {
            $res = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
            if ($res.jobId -eq $jobId -and $res.status -in @("completed", "partial", "failed")) {
                $res | ConvertTo-Json -Depth 10
                exit 0
            }
        } catch {}
    }
}

throw "Timeout after ${TimeoutSeconds}s waiting for job $jobId"
