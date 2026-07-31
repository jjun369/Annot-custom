# ADR 0009: Windows-only desktop support

Status: Accepted, supersedes ADR 0008 for active product development.

## Decision

PageDock supports Windows 10/11 x64 only. Development, automated checks, packaging, installation guidance, updates, code signing, performance work, and friend distribution target Windows.

The experimental Apple Silicon port and its private CI artifacts are historical work. They are not supported, rebuilt, tested, published, or distributed. Existing cross-platform branches may remain temporarily when removing them would create unrelated risk, but new changes do not need macOS or Linux compatibility.

## Rationale

The owner will use and distribute PageDock only on Windows. Maintaining a second desktop platform would consume verification and release effort without serving the intended users. Concentrating on Windows gives PDF behavior, installer size, first-run setup, updates, and recovery workflows a clearer quality target.

## Consequences

- Windows regressions block release; macOS/Linux regressions do not.
- Release documentation and support instructions describe Windows only.
- No Mac signing, notarization, DMG/ZIP generation, real-device test, or update metadata is planned.
- User-data portability is guaranteed across Windows PCs and changed Windows paths, not across operating systems.
- ADR 0008 remains in the repository only to explain historical code and artifacts.
