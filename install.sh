#!/usr/bin/env bash
set -euo pipefail

# ClaudeCast installer
# Usage: curl -fsSL https://raw.githubusercontent.com/ultralazr/ClaudeCast/main/install.sh | bash

REPO="https://github.com/ultralazr/ClaudeCast.git"
MIN_NODE=20
MIN_PYTHON=3

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
fail()  { printf "${RED}[x]${NC} %s\n" "$1"; exit 1; }

# ── Check prerequisites ──────────────────────────────────────────────

info "Checking prerequisites..."

missing=()

# Node.js
if command -v node &>/dev/null; then
    node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_ver" -ge "$MIN_NODE" ]; then
        info "Node.js $(node -v) found"
    else
        missing+=("Node.js 20+ (found $(node -v))")
    fi
else
    missing+=("Node.js 20+ — https://nodejs.org")
fi

# Python
if command -v python3 &>/dev/null; then
    py_ver=$(python3 -c 'import sys; print(sys.version_info.major)')
    if [ "$py_ver" -ge "$MIN_PYTHON" ]; then
        info "Python $(python3 --version | cut -d' ' -f2) found"
    else
        missing+=("Python 3.9+ (found $(python3 --version))")
    fi
elif command -v python &>/dev/null; then
    py_ver=$(python -c 'import sys; print(sys.version_info.major)')
    if [ "$py_ver" -ge "$MIN_PYTHON" ]; then
        info "Python $(python --version | cut -d' ' -f2) found"
    else
        missing+=("Python 3.9+ (found $(python --version))")
    fi
else
    missing+=("Python 3.9+ — https://python.org")
fi

# pip
if command -v pip3 &>/dev/null || command -v pip &>/dev/null; then
    info "pip found"
else
    missing+=("pip — install via: python3 -m ensurepip")
fi

# ffmpeg
if command -v ffmpeg &>/dev/null; then
    info "ffmpeg found"
else
    missing+=("ffmpeg — brew install ffmpeg / sudo apt install ffmpeg / sudo pacman -S ffmpeg")
fi

# git
if command -v git &>/dev/null; then
    info "git found"
else
    missing+=("git")
fi

if [ ${#missing[@]} -gt 0 ]; then
    echo ""
    fail "Missing prerequisites:
$(printf '  - %s\n' "${missing[@]}")

Install the above and re-run this script."
fi

echo ""

# ── Determine install location ───────────────────────────────────────

default_dir="$HOME/ClaudeCast"

if [ -t 0 ]; then
    # Interactive — ask the user
    printf "Install directory [${default_dir}]: "
    read -r install_dir
    install_dir="${install_dir:-$default_dir}"
else
    # Piped — use default
    install_dir="$default_dir"
fi

# ── Clone or update ──────────────────────────────────────────────────

if [ -d "$install_dir/.git" ]; then
    info "Existing install found at $install_dir — pulling latest..."
    git -C "$install_dir" pull --ff-only
else
    info "Cloning ClaudeCast to $install_dir..."
    git clone "$REPO" "$install_dir"
fi

cd "$install_dir"

# ── Install dependencies ─────────────────────────────────────────────

info "Installing Node.js dependencies..."
npm install

info "Installing Python dependencies..."
pip_cmd="pip3"
command -v pip3 &>/dev/null || pip_cmd="pip"
$pip_cmd install -r requirements.txt

# ── Install CLI globally ─────────────────────────────────────────────

info "Installing devlog CLI globally..."
npm install -g .

# ── Done ─────────────────────────────────────────────────────────────

echo ""
info "ClaudeCast installed successfully!"
echo ""
echo "Next steps:"
echo "  1. Authenticate with NotebookLM:"
echo "       nlm login"
echo "  2. Run the setup wizard:"
echo "       devlog init"
echo ""
echo "  Installed to: $install_dir"
echo ""
