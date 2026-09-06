# PageDock UX inventory — 2026-08-31

Purpose: evidence bundle for a product/UX refactor review. PageDock is a local-first,
Windows-only PDF study and technical-research desktop app. The intended reference is
Google NotebookLM (renamed Gemini Notebook in Google material current at this review),
not a pixel-for-pixel clone.

## Product constraints that must survive the refactor

- The app must remain useful without AI or a network connection.
- Documents, notes, indexes, credentials, and backups remain local and portable.
- AI is optional and is invoked only after a clear user action; evidence-linked answers
  must distinguish source fact, inference, and uncertainty.
- A document has a stable identity independent of filename and folder, and can belong to
  more than one research project.
- No cloud collaboration, automatic bulk crawling, or direct paid API-key workflow is in
  scope for the current product direction.

## Screens captured from the running app

The empty-state views ran against the normal PageDock library. The populated-library and
reader views used a temporary library outside the user's data. `07-pdf-reader.png` captures
the pre-fix raw Python/Microsoft Store error path; `12-reader-error-sanitized.png` verifies
the corrected reader copy. This is a quality issue, not sample content.

| File | State | Primary observation |
| --- | --- | --- |
| `screenshots/00-welcome.png` | Onboarding step 1 | Clear local-first message, but a three-step technical setup sequence precedes first value. |
| `screenshots/01-library-empty.png` | Empty library | Global library / research / knowledge navigation; duplicate "add PDF" calls to action. |
| `screenshots/02-research.png` | Empty research project | Separate project rail, source search, local papers, Crossref, patent web search, and metadata/index surface. |
| `screenshots/03-knowledge.png` | Empty knowledge inbox | Captures loose notes/files, review queue, conflicts, wiki, and optional OAuth AI connection. |
| `screenshots/04-settings.png` | Settings | Dense all-in-one settings for AI, providers, storage/backups, desktop tools, and presentation. This local-only capture is not uploaded to external reviewers because it contains account-status context. |
| `screenshots/05-help.png` | Contextual help | A useful modal with current-screen, full-guide, and troubleshooting tabs. |
| `screenshots/06-library-with-pdf.png` | Temporary one-PDF library | Shows the current document tree and its still-empty central landing state. |
| `screenshots/07-pdf-reader.png` | Temporary two-page PDF open | PDF toolbar includes page modes, zoom, highlights, translation, export and download. Raw dependency error is visible in the instructional line. |
| `screenshots/08-chat-window.png` | Detached chat route without selected context | Almost blank state: it only tells the user to choose a folder or PDF in the original window. |
| `screenshots/09-global-search.png` | Global-search entry | Search knows files, tags, summaries and personal notes. |
| `screenshots/10-global-search-results.png` | Global-search result | Result exposes filename/path only; there is no notebook-level scope or source-selection control. |
| `screenshots/11-library-unselected-fixed.png` | Post-fix populated library | A PDF is present but not open; the center now correctly asks the user to select a document rather than add a first PDF. |
| `screenshots/12-reader-error-sanitized.png` | Post-fix reader capability failure | The same temporary sample no longer leaks Python/Microsoft Store diagnostics; it explains that text analysis is unavailable while reading and annotation continue. |

## Current information architecture

1. **Library** is the document store and PDF reader. It owns folders, documents,
   annotation, raw-document search, and a separate chat window.
2. **Research** is a project/source-management workspace. It brings together local PDFs,
   Crossref, patent web search, source metadata, local full-text indexing, and analysis.
3. **Knowledge** is a separate inbox → review → conflict → wiki pipeline for loose notes
   and folders. It can ask Codex to propose, but not silently overwrite, knowledge changes.
4. **Settings/onboarding** expose AI tooling, research credentials, library/backups,
   PDF tool preparation, and display preferences.

## Initial design tensions to evaluate

- The three top-level concepts map to different tasks, but the user has to decide whether
  a PDF belongs in Library, Research, or Knowledge before they can study it.
- Research has source management, while the reader and chat live elsewhere. That makes it
  difficult to form one bounded, citation-aware study context.
- The reader toolbar has many actions but no durable "what am I studying and why" layer:
  goal, selected sources, pinned answer, notes, and generated study output are scattered.
- Knowledge is deliberate and provenance-safe, but feels like a separate product instead
  of a notebook artifact built from the same sources and reading notes.
- Helpful local-first boundaries are present, but optional AI/tool setup is prominent early
  and raw local dependency failures can leak into a study flow.

## NotebookLM / Gemini Notebook patterns to assess, not copy blindly

Google's official documentation describes a **notebook** as an isolated collection of
curated sources. Within one notebook, chat is source-grounded with inline citations; users
can select individual sources, and a Studio creates durable outputs such as briefing docs,
FAQs, study guides, mind maps, flashcards/quizzes, and audio/video overviews. Its source
collection, chat, and studio are three views of one bounded context. PageDock should retain
its local-first and evidence rules, use its own terminology and visual system, and avoid
adding cloud-only media generation as a prerequisite.

Reference material for reviewers:

- Google NotebookLM Help: Learn about NotebookLM (source-grounded chat, citations, study
  outputs): <https://support.google.com/notebooklm/answer/16164461?hl=en>
- Google NotebookLM Help: Add or discover new sources (source selection, source types and
  research flow): <https://support.google.com/notebooklm/answer/16215270?hl=en-GB>
- Google NotebookLM Help Center (current Studio artifact categories):
  <https://support.google.com/notebooklm/?hl=en>

## Review questions

1. What should become the single primary object: a notebook/study space, a project, or a
   document? How can it reuse existing data rather than force a risky migration?
2. Which NotebookLM patterns create immediate value for a local PDF learner, and which
   should explicitly stay out of scope?
3. What is the smallest coherent first delivery that improves navigation, study context,
   source selection, evidence/citations, and durable notes without pretending to implement
   a full AI studio?
4. How should Library, Research, Knowledge, and the detached chat route change over
   successive releases while protecting no-AI use and current local data?
5. What reliability and UX debt must be fixed before, or alongside, the new workflow?
