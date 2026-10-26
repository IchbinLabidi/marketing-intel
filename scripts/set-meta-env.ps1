# Writes META_APP_ID and META_APP_SECRET into .env.local without echoing the secret.
# Usage (from the project folder): & .\scripts\set-meta-env.ps1
$file = Join-Path $PSScriptRoot '..\.env.local' | Resolve-Path
$id = (Read-Host 'Meta App ID (digits)').Trim()
$secure = Read-Host 'Meta App Secret' -AsSecureString
$secret = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
if (-not $id -or -not $secret) { Write-Host 'Both values are required. Nothing was changed.'; exit 1 }

$lines = [IO.File]::ReadAllLines($file)
foreach ($key in 'META_APP_ID', 'META_APP_SECRET') {
  if (-not ($lines -match "^$key=")) { $lines += "$key=" }
}
$lines = $lines -replace '^META_APP_ID=.*', "META_APP_ID=$id" -replace '^META_APP_SECRET=.*', "META_APP_SECRET=$secret"
[IO.File]::WriteAllLines($file, $lines)  # UTF-8 without BOM
Write-Host "Saved to $file (App ID: $($id.Length) chars, secret: $($secret.Length) chars)"
