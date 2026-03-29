# ClaudeCast installer for Windows
# Usage: irm https://raw.githubusercontent.com/ultralazr/ClaudeCast/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "git@github.com:ultralazr/ClaudeCast.git"
$MinNode = 20

function Info($msg)  { Write-Host "[+] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }

# ── Check prerequisites ──────────────────────────────────────────────

Info "Checking prerequisites..."

$missing = @()

# Node.js
try {
    $nodeVer = (node -v) -replace 'v','' -split '\.' | Select-Object -First 1
    if ([int]$nodeVer -ge $MinNode) {
        Info "Node.js $(node -v) found"
    } else {
        $missing += "Node.js 20+ (found $(node -v)) — https://nodejs.org"
    }
} catch {
    $missing += "Node.js 20+ — https://nodejs.org or: winget install OpenJS.NodeJS.LTS"
}

# Python
try {
    $pyVer = python -c "import sys; print(sys.version_info.major)"
    if ([int]$pyVer -ge 3) {
        Info "Python $(python --version) found"
    } else {
        $missing += "Python 3.9+ (found $(python --version))"
    }
} catch {
    $missing += "Python 3.9+ — https://python.org or: winget install Python.Python.3.12"
}

# pip
try {
    pip --version | Out-Null
    Info "pip found"
} catch {
    $missing += "pip — install via: python -m ensurepip"
}

# ffmpeg
try {
    ffmpeg -version | Out-Null
    Info "ffmpeg found"
} catch {
    $missing += "ffmpeg — winget install Gyan.FFmpeg"
}

# git
try {
    git --version | Out-Null
    Info "git found"
} catch {
    $missing += "git — https://git-scm.com or: winget install Git.Git"
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Fail "Missing prerequisites:`n$(($missing | ForEach-Object { "  - $_" }) -join "`n")`n`nInstall the above and re-run this script."
}

Write-Host ""

# ── Determine install location ───────────────────────────────────────

$defaultDir = Join-Path $HOME "ClaudeCast"
$installDir = Read-Host "Install directory [$defaultDir]"
if ([string]::IsNullOrWhiteSpace($installDir)) { $installDir = $defaultDir }

# ── Clone or update ──────────────────────────────────────────────────

if (Test-Path (Join-Path $installDir ".git")) {
    Info "Existing install found at $installDir — pulling latest..."
    git -C $installDir pull --ff-only
} else {
    Info "Cloning ClaudeCast to $installDir..."
    git clone $Repo $installDir
}

Set-Location $installDir

# ── Install dependencies ─────────────────────────────────────────────

Info "Installing Node.js dependencies..."
npm install

Info "Installing Python dependencies..."
pip install -r requirements.txt

# ── Install CLI globally ─────────────────────────────────────────────

Info "Installing devlog CLI globally..."
npm install -g .

# ── Done ─────────────────────────────────────────────────────────────

Write-Host ""
Info "ClaudeCast installed successfully!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Authenticate with NotebookLM:"
Write-Host "       nlm login"
Write-Host "  2. Run the setup wizard:"
Write-Host "       devlog init"
Write-Host ""
Write-Host "  Installed to: $installDir"
Write-Host ""
