param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

$batchScript = Join-Path $PSScriptRoot 'build_game_wasm.bat'
if (-not (Test-Path $batchScript)) {
    throw "未找到构建脚本: $batchScript"
}

& $batchScript $RepoRoot
exit $LASTEXITCODE
