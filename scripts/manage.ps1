param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('install', 'uninstall')]
    [string]$Action,
    [string]$PluginsDirectory = (Join-Path $env:USERPROFILE '.gemini\config\plugins')
)

$ErrorActionPreference = 'Stop'

$pluginRoot = [IO.Path]::GetFullPath($PluginsDirectory).TrimEnd('\', '/')
$destination = [IO.Path]::GetFullPath((Join-Path $pluginRoot 'neko-memory'))

if ($Action -eq 'uninstall') {
    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
        Write-Host "[OK] 已卸载 neko-memory：$destination"
        Write-Host "[i] 你的长期记忆数据库保存在 $env:USERPROFILE\.gemini\antigravity\neko_memory\memory.db（已保留，不会被删除）。"
    } else {
        Write-Host "[i] 未安装 neko-memory：$destination"
    }
    exit 0
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'plugin.json'))) {
    throw "缺少 plugin.json：$repoRoot"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null

# Copy plugin runtime files only
$filesToCopy = @('plugin.json', 'mcp_config.json', 'README.md', 'LICENSE')
foreach ($f in $filesToCopy) {
    $srcFile = Join-Path $repoRoot $f
    if (Test-Path -LiteralPath $srcFile) {
        Copy-Item -LiteralPath $srcFile -Destination (Join-Path $destination $f) -Force
    }
}
$dirsToCopy = @('assets', 'lib', 'mcp', 'rules', 'sidecars', 'skills')
foreach ($d in $dirsToCopy) {
    $srcDir = Join-Path $repoRoot $d
    $dstDir = Join-Path $destination $d
    if (Test-Path -LiteralPath $srcDir) {
        & robocopy.exe $srcDir $dstDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "复制目录失败：$d (exit $LASTEXITCODE)" }
    }
}

# Resolve Node executable: prefer system node >= 22.5, otherwise fallback to Antigravity built-in agy-node.cmd
$nodeCmd = 'node'
$hasSystemNode = $false
try {
    $ver = (& node -v 2>$null)
    if ($ver -match '^v(\d+)\.(\d+)') {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 5)) { $hasSystemNode = $true }
    }
} catch {}

$agyNode = Join-Path $env:APPDATA 'Antigravity\bin\agy-node.cmd'
if (-not $hasSystemNode -and (Test-Path -LiteralPath $agyNode)) {
    $nodeCmd = $agyNode.Replace('\', '/')
    Write-Host "[i] 未检测到 Node.js 22.5+，自动使用 Antigravity 内置运行环境：$nodeCmd"
}

$mcpServerPath = (Join-Path $destination 'mcp\server.mjs').Replace('\', '/')
$mcpConfig = @{
    mcpServers = @{
        'neko-memory' = @{
            command = $nodeCmd
            args = @($mcpServerPath)
        }
    }
}
$mcpJsonPath = Join-Path $destination 'mcp_config.json'
[IO.File]::WriteAllText($mcpJsonPath, ($mcpConfig | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "[OK] 猫猫的记忆 (neko-memory) 已成功安装到：$destination"
Write-Host "[i] 重启 Antigravity 或开启新对话后即可生效！"
Write-Host "[i] 在对话中输入「打开猫猫的记忆星图面板」即可浏览 2D/3D 记忆星图。"
exit 0
