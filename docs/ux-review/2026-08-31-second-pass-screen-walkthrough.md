# PageDock 기능별 화면 워크스루 — 2026-08-31

## 목적과 재현 조건

기존의 정적 화면 인벤토리보다 한 단계 더 깊게, 실제 클릭·입력·로컬 색인
흐름을 임시 PageDock Library에서 재현해 캡처한 검토 묶음이다. 이 과정에서
사용자 라이브러리, Knowledge, 백업, API 키는 변경하지 않았다.

- 임시 데이터: 2-page local PDF 1개, `UX Review Sources` 폴더 1개,
  `Reactive Systems Study` project 1개, 수동 입력 Knowledge note 1개.
- 외부 AI 실행, Codex 정밀 분석, Crossref/특허 웹 검색은 실행하지 않았다.
- `12-settings.png`에는 마스킹된 계정 상태가 보이므로 로컬 검토 증거로만
  보관하며 외부 리뷰에 업로드하지 않는다.
- 화면 파일은 [`screenshots/second-pass`](screenshots/second-pass)에 있다.

## Library, Reader, search, folder chat

| Capture | 실제 동작/상태 | 관찰 포인트 |
| --- | --- | --- |
| `00-library-unselected.png` | PDF 1개가 있으나 선택하지 않음 | 올바른 “읽을 문서를 선택하세요” 상태. 중앙 CTA는 없다. |
| `01-reader-default.png` | PDF 열기 | page/zoom/view/search/highlight/translate/export/download toolbars와 raw-error safe notice. |
| `02-reader-text-search.png` | Reader local search 열기 | PDF 안에서 검색 입력. |
| `03-reader-search-results.png` | `searchable` 검색 | 2쪽을 하나의 결과로 찾아 이동 button을 제공. |
| `04-reader-annotation-list.png` | highlight inspector 열기 | 현재 0개이고, 텍스트 선택 → 중요/확인 필요 highlight라는 사용법만 안내. |
| `05-folder-overview-empty.png` | local folder 생성·선택 | folder-local filter/sort, PDF list, metadata side detail, prior chat entry가 한 화면에 존재. |
| `06-folder-chat-panel.png` | folder research chat 시작 | session을 생성하고 resizable right chat panel을 연다. |
| `07-folder-chat-ready.png` | chat panel | model/reasoning controls, canned prompts, input. 현재 folder PDF가 0개여도 chat을 시작할 수 있다. |
| `08-global-search-entry.png` | Ctrl+K search | filename/tag/summary/note를 함께 찾는 전역 검색이다. |
| `09-global-search-results.png` | `Reactive` 검색 | filename/path result로 PDF를 연다. space/source scope 또는 page snippet은 없다. |
| `10-help-context.png` | contextual help | current screen guidance와 keyboard hint. |
| `11-help-troubleshooting.png` | help troubleshooting tab | OAuth, AI cancel, conflict/revision, backup recovery copy를 제공. |
| `24-detached-chat-empty.png` | standalone `/chat-window` | main window context가 없으면 한 줄 안내만 보인다. |

## Settings

| Capture | 실제 동작/상태 | 관찰 포인트 |
| --- | --- | --- |
| `12-settings.png` | provider, research credentials, root/backup, desktop tools, appearance | 개인 정보·보안·복구와 presentation preference가 하나의 긴 화면에 혼재한다. |

## Research

| Capture | 실제 동작/상태 | 관찰 포인트 |
| --- | --- | --- |
| `13-research-all-documents.png` | global research document registry | local / Crossref / patent-web search source mode, document list, project rail. |
| `14-research-project-create.png` | project creation modal | name, description, analysis profile를 선택한다. |
| `15-research-project-empty.png` | created project with no linked material | Project membership is empty and separate from Library. |
| `16-research-manual-patent.png` | manual patent modal | PDF 없이 identifier, display title, URL만 먼저 저장 가능. |
| `17-research-crossref-search.png` | Crossref source selected | external-source mode와 local document workbench가 같은 화면에 공존. |
| `25-research-document-detail.png` | document detail | metadata/name/kind, local index, rename proposal, PDF deep-link, Codex analysis action. |
| `26-research-index-progress.png` | local text index start | in-progress page counter, percentage, cancel. |
| `27-research-index-complete.png` | local text index complete | title improved from PDF text; Codex analysis becomes available only after index. |

## Knowledge

| Capture | 실제 동작/상태 | 관찰 포인트 |
| --- | --- | --- |
| `18-knowledge-inbox-empty.png` | capture inbox | raw text/file capture is local; AI organization requires ChatGPT OAuth. |
| `19-knowledge-draft.png` | knowledge text draft | draft is locally auto-saved before capture. |
| `20-knowledge-inbox-item.png` | capture submit | original note appears in queue; AI organize remains disabled without OAuth. |
| `21-knowledge-review-empty.png` | review queue | no pending reviewed changes yet. |
| `22-knowledge-conflicts-empty.png` | conflict queue | no conflicts yet. |
| `23-knowledge-wiki-empty.png` | wiki | markdown export is available, but no topic has been promoted. |

## 기능상 재검토해야 할 사실

1. 자료 경계가 `Library root/folder`, `Research Project`, `Knowledge`, `Chat session`에
   각각 존재해 한 공부 단위의 source boundary가 불명확하다.
2. root-level PDF는 `activeSessionFolder === ''`라서 current UI의 AI chat entry가
   사라진다. Folder를 만들어야 chat controls가 보인다.
3. Reader local search는 유용하지만 global search는 filename/path 중심이며 reader
   location과 space membership을 보존하지 않는다.
4. Research는 local indexing과 evidence-ready analysis gate를 갖고 있으나 Reader와
   Notes/Chat surface가 분리되어 있다.
5. Knowledge의 capture → review → conflicts → wiki 안전성은 강점이지만, 현재
   학습 중의 note/highlight와 직접적인 source/locator 연결은 없다.
6. optional AI readiness가 Settings에서는 usable Codex, Knowledge에서는 OAuth required로
   다르게 보인다. AI를 쓰지 않는 작업 흐름도 설정 상태를 자주 마주친다.
7. detached chat은 source-bound multi-window feature가 아니라 current-window context를
   기다리는 빈 화면이 된다.
