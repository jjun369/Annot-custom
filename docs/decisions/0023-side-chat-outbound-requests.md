# ADR 0023: Immutable side-chat outbound requests

Status: Accepted.

## Decision

A sidechat user message may have optional `sideChatWebRequests[]`. Preparing an explicit copy creates a stable request ID under that question in the existing session-file mutation lock. It captures session/question IDs, provider, intent/mode, prompt version, exact prompt and SHA-256, selected assistant ID and text when applicable, bounded source context/path hint, and preparation time. Only an acknowledged clipboard operation may add `copiedAt`; neither timestamp claims web transmission or login. Snapshot fields are immutable. Conflicting request-ID reuse fails.

New imports bind to that stored request ID, never current composer/tab/mode state. Validation checks the saved snapshot integrity and anchor, without rebuilding it using a newer prompt version. Same request and normalized response is idempotent; distinct explanations survive. Existing request-less perspectives and Reader assistant/user DeepSeek records remain readable and are never assigned invented copy timestamps or reparented.

New side-chat prompts use `pagedock-sidechat-v2`: independent explanation excludes previous answers; explicit answer review may include a linked assistant with or without PDF source and asks about claims, evidence, assumptions, and uncertainty. The v1 builder remains available for legacy request-less imports. Source is included only in source modes; all preserved locators remain bounded snapshots.

Requests and saved perspectives travel through existing v1/v2 session backup paths. SQLite schema and backup manifests do not change. Response drafts are device-local, keyed by Library/session/request; unsaved composer drafts also distinguish mode and answer. Storage failures are visible and retain in-memory text. Old unscoped drafts are not silently assigned to a new Library.

Electron owns one tab controller with per-provider loading promises, selection generation, validated host bounds, visibility and close lifecycle. A hidden or loading tab cannot steal focus; local overlays hide the native view. Load failures offer explicit retry/system-browser actions without automatically spawning external windows. Remote contents have no PageDock preload or credentials/DOM inspection capability.

## Consequences

Users can recover the actual prepared/copied question after mode changes or restart and select any two saved explanations for descriptive comparison. Hashes establish local integrity only, not external receipt, agreement, or correctness. Requests remain even if clipboard acknowledgment fails, with accurate preparation-only status.
