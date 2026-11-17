# Stores the GitHub token that release builds seal into the app for update checks.
#
# Create the token first (github.com > Settings > Developer settings >
# Personal access tokens > Fine-grained tokens > Generate new token):
#   - Repository access: Only select repositories > PBF-generator
#   - Permissions > Repository > Contents: Read-only   (Metadata: Read-only is automatic)
#   - Nothing else.
#
# Run this in your own terminal; it prompts without echoing. The token is saved
# encrypted with Windows DPAPI (only your Windows account on this PC can read it),
# outside the repository, at %APPDATA%\PBF Generator release\update-token.dat.

$ErrorActionPreference = 'Stop'
$repo = 'meowyourhead/PBF-generator'
$dir = Join-Path $env:APPDATA 'PBF Generator release'
New-Item -ItemType Directory -Force $dir | Out-Null

$secure = Read-Host -AsSecureString 'Paste the fine-grained token (input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if (-not $plain.StartsWith('github_pat_')) {
        throw 'That is not a fine-grained token (they start with github_pat_). Classic tokens can reach every repo; use a fine-grained one.'
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ Authorization = "Bearer $plain"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'PBF-Generator-Release' }
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo" -Headers $headers
    if ($r.full_name -ne $repo) { throw "Token can't see $repo" }
    $null = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases?per_page=1" -Headers $headers
} finally {
    $plain = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$secure | ConvertFrom-SecureString | Set-Content -Encoding ascii (Join-Path $dir 'update-token.dat')
Write-Host "Token checked and saved (DPAPI-encrypted) in $dir"
