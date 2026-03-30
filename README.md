# ClaudeCast - Create structured summaries and podcasts from your Claude session logs

ClaudeCast pulls your **Claude Code session logs**, strips personal/sensitive data locally (according to **configurable redaction rules**), then uploads session extracts to Google NotebookLM (NLM) to create **structured session summaries (topics, challenges, decisions, lessons learned, etc)**.

Because you can't even be bothered to read these, ClaudeCast also **generates a hilarious 25 minute deep-dive podcast episode** via NLM, roasting (or praising - change the prompt file to taste) the desasters you and your clanker created/prevented in the last days.

Because you're too busy chilling & travelling while your agent is busy putting food on the table, ClaudeCast can **automatically upload the latest episode to your personal/shareable podcast feed** (requires free-tier Cloudflare R2 bucket). The next episode will automatically pick up where the previous episode left off, and include a summary of the previous episode by default. 

**Finally learn why Claude secretly tried to click that same website button a zillion times (and then decided not to tell you about it), while you hit the beach. Share your agentic coding adventures with friends & family - or anybody who didn't ask for it.**


![ClaudeCast](publisher/cover-promo.png)

## How it works

1. **Extract** — reads raw Claude Code session files from `~/.claude/`
2. **Redact** — strips personal data using configurable rules
3. **Summarize** — uploads session content to NotebookLM, queries for per-project summaries
4. **Podcast** — NotebookLM generates a Deep Dive audio episode
5. **Post-process** — adds intro/outro music and optional talker overlay
6. **Publish** — uploads to Cloudflare R2, regenerates RSS feed

## Prerequisites

- **Node.js** 20+
- **Python** 3.9+
- **ffmpeg** — install and add to PATH:
  ```bash
  # macOS
  brew install ffmpeg
  # Ubuntu / Debian
  sudo apt install ffmpeg
  # Arch
  sudo pacman -S ffmpeg
  # Windows
  winget install Gyan.FFmpeg
  ```
- **[NotebookLM](https://notebooklm.google.com/) account** — after install, authenticate with `nlm login`
- **Cloudflare account** *(optional, for publishing)* — R2 bucket + Worker

## Installation

**One-liner (Linux / macOS):**
```bash
curl -fsSL https://raw.githubusercontent.com/ultralazr/ClaudeCast/main/install.sh | bash
```

**One-liner (Windows PowerShell):**
```powershell
irm https://raw.githubusercontent.com/ultralazr/ClaudeCast/main/install.ps1 | iex
```

**Manual install:**
```bash
git clone https://github.com/ultralazr/ClaudeCast.git
cd ClaudeCast
npm install                # auto-builds TypeScript via prepare script
pip install -r requirements.txt   # Python dependencies
npm install -g .           # installs the devlog command globally
devlog init                # interactive setup wizard
```

`devlog init` will:
- Ask for your Claude data directory (default: `~/.claude`)
- Optionally configure Cloudflare publishing
- Create `config/projects.json` and `publisher/config.json`
- Copy starter redaction config files
- Check that all prerequisites are reachable

## Quick start

Once installed, generate your first episode:

```bash
devlog episode --dry-run    # preview what sessions would be processed
devlog episode              # extract, redact, summarize, generate podcast
devlog postprocess data/episodes/01/*.m4a   # re-run audio post-processing if needed
```

## Claude Code users

If you're setting up ClaudeCast with Claude Code, ask it to:
- Scan your session files and suggest additions to `config/redact.csv` and `config/redact-patterns.csv`
- Help you personalise `config/stage2-prompt.txt` to match your podcast style and host persona

### Automated setup prompt

Paste this into Claude Code to have it handle the full installation:

```
I need help installing and setting up ClaudeCast. Here's what the project does and how to install it:

---

Automatically generates a weekly developer podcast from your Claude Code session logs. Each week's coding sessions are summarized per project by NotebookLM, then combined into a single audio episode.

**Prerequisites:**
- Node.js 20+
- Python 3.9+
- ffmpeg (installed and on PATH)
- NotebookLM account (authenticated via `nlm login`)
- Cloudflare account (optional, for publishing)

**Installation steps:**
1. `npm install` — builds TypeScript via prepare script
2. `pip install -r requirements.txt` — installs Python dependencies (notebooklm-tools is bundled inside notebooklm-mcp-cli)
3. `npm install -g .` — installs the `devlog` command globally
4. `devlog init` — interactive setup wizard

**What I need you to do:**
1. Check that all prerequisites are installed (node, python, ffmpeg, nlm CLI). Tell me what's missing before proceeding.
2. Run the installation steps above.
3. Run `devlog init` and walk me through the prompts.
4. After init completes, scan my session files in ~/.claude/ and suggest additions to `config/redact.csv` and `config/redact-patterns.csv` so personal data gets stripped before reaching NotebookLM.
5. Help me personalise `config/stage2-prompt.txt` to match my preferred podcast style and host persona.
```

## Audio wrappers

Default intro/outro music and a talker overlay are included in `assets/audio/`. They're used automatically — no setup needed.

To use your own files, place them in `data/audio_wrappers/` with these exact names (they take priority over the defaults):

| File | Role |
|------|------|
| `music.wav` | Intro/outro background music (any length ≥ 30s) |
| `talker.mp3` | Optional voice overlay that plays over the intro music |

The post-processing adds a 23-second music intro, crossfades into the NLM audio, and fades back out to music for the outro.

## Redaction

Two config files control what gets redacted from session logs before they reach NotebookLM:

**`config/redact.csv`** — term substitution (copy from `config/redact.example.csv`):
```csv
term,replacement,case_sensitive
Acme Corp,Example Inc.,false
john.doe,demo-user-1,false
```

**`config/redact-patterns.csv`** — regex patterns (copy from `config/redact-patterns.example.csv`):
```csv
pattern,replacement,flags
[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,},[email],gi
```

Both files are gitignored — your redaction rules stay private.

## Excluding sessions

To skip specific sessions from extraction, add their IDs (or prefixes) to `config/exclude-sessions.txt`:

```
a1b2c3d4          # test session
9f8e7d6c-1234     # contains sensitive content
```

Prefix matching means you only need the first 8 characters. This file is gitignored.

## Podcast prompt customization

The NLM prompt that generates your podcast is in `config/stage2-prompt.txt`. Edit it to change the podcast style, host persona, or how projects are described. The prompt references the developer by name — update it to match your own handle.

## Commands

```bash
devlog init                   # First-time setup wizard

devlog episode                # Process current episode (incremental, since last run)
devlog episode --dry-run      # Preview what would be processed without calling NLM
devlog episode --from <date>  # Override window start (e.g. 2026-03-01)
devlog episode --to <date>    # Override window end (default: now)
devlog episode --session <id> [<id>...]   # Include specific sessions only (prefix match)
                                          # Combine with --from/--to to filter further

devlog postprocess <input> [output]       # Re-run audio post-processing on an existing file

devlog backfill               # Process all historical episodes
devlog backfill --dry-run     # Preview without calling NLM
devlog backfill --limit 1     # Process only the oldest unprocessed episode

devlog publish                # Upload new episodes to Cloudflare R2 + regenerate RSS
devlog publish --dry-run      # Preview without uploading
devlog publish --force        # Re-upload all episodes

devlog config add-project <path> <name>   # Map a project directory to a friendly name
devlog config list-projects               # List configured project mappings
```

## Project mappings

ClaudeCast groups sessions by the `cwd` recorded in Claude Code session files. Without mappings the folder names are used as-is (functional but ugly). Add friendly names:

```bash
devlog config add-project ~/projects/my-app "my-app"
```

## Data directory layout

```
data/
  audio_wrappers/   # Your music and talker files (gitignored)
  episodes/         # Generated per-episode summaries and podcast files (gitignored)
  logs/             # Processed session markdown (gitignored)
  state/            # episodes.json tracking state (gitignored)
config/
  projects.json          # Your personal config (gitignored)
  redact.csv             # Your redaction terms (gitignored)
  redact-patterns.csv    # Your regex patterns (gitignored)
  exclude-sessions.txt   # Session IDs to skip (gitignored)
  stage2-prompt.txt      # NLM podcast prompt (committed, customize freely)
```

## Acknowledgements

- [notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) — Python client for the NotebookLM API
