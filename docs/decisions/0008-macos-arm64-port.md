# ADR 0008: Apple Silicon macOS port and protected credentials

Status: Accepted for private friend testing

PageDock adds an Apple Silicon arm64 desktop target without replacing the existing Electron/Next.js architecture or changing user-data formats. The first artifact is an unsigned, unnotarized DMG plus ZIP built on a macOS CI runner and retained as a private workflow artifact. It is never published automatically to the public release repository. Mac App Store packaging is deferred because its mandatory sandbox conflicts with the current arbitrary library access and external Codex/Python process model.

The existing `app.pagedock.desktop` identifier is retained. Windows continues to use NSIS, DPAPI, and the official Windows Codex/Python preparation paths. macOS uses native application-data paths, an ordinary native menu, Dock window restoration, common official Codex locations, ChatGPT browser OAuth through the Codex CLI, and an app-managed Python virtual environment when a user explicitly prepares PyMuPDF.

Optional research-provider secrets remain outside the library and backups. Windows version-1 settings continue to hold DPAPI ciphertext. On macOS the same JSON shape holds only `keychain:<key>` markers while values live in the user's macOS Keychain under service `app.pagedock.desktop.research`. Missing, locked, or foreign credentials are ignored without disabling local library or knowledge use. No plaintext credential is added to source, backups, logs, or the library.

Before any public Mac release, PageDock must pass real M-series hardware testing, enable hardened runtime, sign every bundle with Developer ID Application, notarize and staple the artifact, verify it with `codesign`, `spctl`, and `stapler`, and explicitly add signed macOS update metadata. Until then Mac automatic updates remain outside the supported release contract.
