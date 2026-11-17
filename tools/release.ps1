# Builds the app with the update token sealed in, signs it, and (with -Publish)
# uploads it as a GitHub release of the private repo.
#
#   powershell -ExecutionPolicy Bypass -File tools\release.ps1             # build + sign only
#   powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Publish    # ...and create the release
#
# Secrets live outside the repo in %APPDATA%\PBF Generator release\, encrypted
# with Windows DPAPI:
#   update-token.dat  the read-only GitHub token  (tools\set-update-token.ps1)
#   signing-key.dat   the Ed25519 release-signing key (made on the first run)
# Back up signing-key.dat somewhere safe: without it, installed copies will not
# accept new updates (they would need a manual reinstall with a new key).

param(
    [switch]$Publish,
    [switch]$KeyOnly,   # only create the signing key (first-time setup)
    [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
$repo = 'meowyourhead/PBF-generator'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$secrets = Join-Path $env:APPDATA 'PBF Generator release'
$tokenFile = Join-Path $secrets 'update-token.dat'
$keyFile = Join-Path $secrets 'signing-key.dat'
$pubFile = Join-Path $app 'update_pubkey.txt'
New-Item -ItemType Directory -Force $secrets | Out-Null

function Read-Dpapi($path) {
    $s = Get-Content $path | ConvertTo-SecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$version = (Select-String -Path (Join-Path $app 'Cargo.toml') -Pattern '^version\s*=\s*"([0-9.]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
$parts = $version.Split('.')
$tag = if ($parts[2] -eq '0') { "v$($parts[0]).$($parts[1])" } else { "v$version" }

Push-Location $app
try {
    # ---- signing key ---------------------------------------------------------
    cargo build --release --bin pbf_sign
    if ($LASTEXITCODE) { throw 'pbf_sign build failed' }
    $signer = Join-Path $app 'target\release\pbf_sign.exe'
    if (-not (Test-Path $keyFile)) {
        if (Test-Path $pubFile) { throw "app\update_pubkey.txt exists but $keyFile is missing. Restore the key from your backup; making a new one would lock out installed copies." }
        $out = & $signer keygen
        if ($LASTEXITCODE -or $out.Count -ne 2) { throw 'keygen failed' }
        ConvertTo-SecureString $out[0] -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Encoding ascii $keyFile
        $out = $null
        Write-Host "New signing key saved to $keyFile -- back it up."
    }
    # The public half is derived from the key every run, so it always matches.
    $key = Read-Dpapi $keyFile
    try { $pub = $key | & $signer pubkey } finally { $key = $null }
    if ($LASTEXITCODE -or "$pub".Length -ne 64) { throw 'could not read the signing key' }
    if (-not (Test-Path $pubFile) -or (Get-Content -Raw $pubFile).Trim() -ne $pub) {
        [IO.File]::WriteAllText($pubFile, $pub)
        Write-Host "Public key written to app\update_pubkey.txt (commit it)."
    }

    if ($KeyOnly) { return }
    if (-not (Test-Path $tokenFile)) { throw "No update token yet. Run tools\set-update-token.ps1 first." }

    # ---- build with the token sealed in --------------------------------------
    $env:PBF_UPDATE_TOKEN = Read-Dpapi $tokenFile
    try {
        cargo build --release
        if ($LASTEXITCODE) { throw 'cargo build failed' }
    } finally {
        Remove-Item Env:\PBF_UPDATE_TOKEN -ErrorAction SilentlyContinue
    }

    # ---- stage, sign ----------------------------------------------------------
    $dist = Join-Path $app 'target\dist'
    New-Item -ItemType Directory -Force $dist | Out-Null
    $exe = Join-Path $dist 'PBF-Generator.exe'
    Copy-Item .\target\release\pbf_generator.exe $exe -Force
    $key = Read-Dpapi $keyFile
    try { $sig = $key | & $signer sign $exe $version } finally { $key = $null }
    if ($LASTEXITCODE -or -not $sig) { throw 'signing failed' }
    [IO.File]::WriteAllText((Join-Path $dist 'PBF-Generator.exe.sig'), "$sig")
    Copy-Item $exe (Join-Path $root 'PBF Generator.exe') -Force
    Write-Host "Built and signed $tag -> $dist (and copied to the project root)"

    # ---- publish ---------------------------------------------------------------
    if ($Publish) {
        if (-not $Notes) { $Notes = "PBF Generator $tag" }
        gh release create $tag --repo $repo --title "PBF Generator $tag" --notes $Notes $exe (Join-Path $dist 'PBF-Generator.exe.sig')
        if ($LASTEXITCODE) { throw 'gh release create failed' }
        Write-Host "Published $tag to $repo"
    }
} finally {
    Pop-Location
}
