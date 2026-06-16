<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

## ⚡ trie-native fork

> This is a fork of opencode that is **trie-native**: it ships [trie](https://github.com/computer-reinvention/trie)'s symbol-graph tools as the default toolset and treats opencode's stock file tools as backup.

In a project that has trie installed (a `trie.toml` at the root with a synced graph), this build changes the agent's defaults so it works against trie's prose/symbol graph instead of grepping raw text:

- **Navigation is trie-first.** The agent's primary tools are `trie_grep`, `trie_read`, `trie_trace`, `trie_grep_entry_points`, `trie_grep_symbol`, `trie_grep_symbol_neighbours`, `trie_grep_str` (with `all_files` to reach non-indexed files too), `trie_find` (filename/path glob), `trie_explain_symbol`, `trie_explain_symbol_refs`, `trie_trace_flow`, `trie_explain_flow`, and `trie_blast_radius`. They search an indexed symbol graph and return signatures, prose, and call-graph context — not just line matches.
- **Editing goes through the patch pipeline.** Code changes are made by recording intent against symbols — `trie_patch` (modify), `trie_create_symbol` / `trie_delete_symbol` / `trie_rename_symbol` (structural) — then `trie_patch_preview` and `trie_patch_apply`. The pipeline regenerates source, cascades the change to callers, fixes imports, runs compile + LSP, and commits atomically.
- **Backup tools are demoted.** The stock `grep` / `read` / `glob` / `edit` / `write` tools are framed as backups (`fs_*`) for the cases trie does not cover: non-indexed files (non-Python code, configs, docs, lockfiles), brand-new files, images/PDFs, directory listings, and sub-symbol / non-symbol-region edits.
- **An edit guard keeps the agent honest.** `edit` / `write` refuse to hand-edit a trie-indexed code file and point the agent to the patch pipeline. A `force: true` argument is the documented escape hatch for sub-symbol or non-symbol-region edits the pipeline can't express, and `experimental.trie_edit_guard: false` disables the guard entirely.
- **The system prompt teaches trie.** When trie is available, a usage guide is injected into every model family's system prompt covering the tools, the patch workflow, and — crucially — **when trie does NOT apply** so the agent falls back to the backup tools cleanly. The `explore` subagent and plan mode are trie-first too (plan mode allows only read-only trie tools + `trie_patch_preview`).

In projects **without** trie, this build behaves exactly like upstream opencode: the trie guidance is not injected and the guard never fires.

Implementation lives under `packages/opencode/src/tool/trie/` (the native tool suite + `shared.ts` runner/probes and `guard.ts`), with the registry wiring in `packages/opencode/src/tool/registry.ts`, the prompt in `packages/opencode/src/session/prompt/trie.txt`, and scenario coverage in `packages/opencode/test/tool/trie.*.scenario.test.ts`. The capability gaps that keep the backup tools necessary are tracked in trie's [`docs/core/trie-tool-extensions.md`](https://github.com/computer-reinvention/trie/blob/main/docs/core/trie-tool-extensions.md).

The rest of this README documents upstream opencode.

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
