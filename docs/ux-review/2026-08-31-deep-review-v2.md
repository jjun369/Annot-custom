# PageDock 딥 리뷰 메모 v2 — 2026-08-31

## 판정

2차 워크스루의 28개 화면과 기존 v1 지시서를 함께 검토한 결론은 명확하다.

> PageDock의 P0 문제는 NotebookLM 기능의 부족이 아니라, 무엇이 공부의 자료
> 경계인지 UI가 Library folder·Research Project·Knowledge·Chat session으로 서로
> 다르게 말하는 데 있다.

따라서 v1의 identity 계약은 유지하되, **Folder Chat을 보수하는 방향은 폐기**한다.
질문할 수 있는 유일한 자료 경계는 `Project.id`를 사용자 언어로 표현한 **학습 공간
(Study Space)** 이다. Library folder는 정리, Chat session은 기록, Knowledge는
검토된 장기 지식으로 역할을 고정한다.

```text
StudySpace.id      = existing Project.id
StudySpace.sources = ProjectDocument membership → global Document
```

Google NotebookLM/Gemini Notebook에서 가져올 것은 `bounded sources → explicit
source selection → source-only answer → inline citation → durable note` 패턴뿐이다.
Studio 생성물, 자동 웹 수집·조사, collaboration, cloud sync, audio/video 생성은
가져오지 않는다. PageDock의 제품 중심은 언제나 **원문 PDF Reader로 즉시 돌아오는
로컬 학습 흐름**이다.

## NotebookLM 비교: 가져올 기능 우선순위

가치는 5가 가장 크고, 비용은 1이 가장 작다. Local-first 적합성은 5가 가장 높다.

| 순위 | 아이디어 | 가치 | 비용 | 적합성 | 결정 |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | 질문마다 명시적인 Source 선택과 scope 표시 | 5 | 2 | 5 | P0 |
| 2 | inline citation → 미리보기 → Reader의 정확한 위치 이동 | 5 | 3 | 5 | P0 |
| 3 | 학습 공간 내부 본문 검색, snippet·page locator | 5 | 2–3 | 5 | P0 |
| 4 | 선택 텍스트/하이라이트/페이지 위치가 붙는 Study Note | 5 | 3 | 5 | P0 |
| 5 | 좋은 답변을 citation과 함께 고정하는 Saved Answer | 4.5 | 2 | 5 | P0 |
| 6 | AI 없는 Source Overview(페이지·검색 상태·최근 위치·메모 수) | 4 | 2 | 5 | P1 |
| 7 | 원문 revision 변경 시 citation stale 및 재질문 유도 | 5 | 3 | 5 | P0 신뢰성 |
| 8 | 같은 Ask pipeline의 Learning Guide 응답 방식 | 3.5 | 1 | 4 | P1 |
| 9 | Highlight/Saved Answer 기반 복습, 오답만 재시도·진행률 | 4 | 4 | 4 | P1/P2 |
| 10 | source label/grouping | 3 | 2 | 5 | P1 |

핵심 상호작용은 다음처럼 분리한다. Source의 **row click은 Reader에서 열기**이고,
checkbox만 **질문에 포함**한다. Reader에 열려 있는 문서가 자동으로 외부 AI에
전송되어서는 안 된다.

## 확인된 UX trap과 결정

1. **Folder가 source boundary처럼 보인다 — P0 blocker.** PDF가 0개인 folder에서도
   연구 대화를 만들 수 있어 grounded chat이라는 약속과 충돌한다. 신규 Folder Chat
   생성은 제거하고, 기존 folder chat은 최소 한 release 동안 `더보기 → 이전 대화`의
   읽기 전용 호환 경로로만 남긴다. legacy chat을 추측해 Space에 reparent하지 않는다.
2. **Root PDF에는 chat이 없고 folder PDF에는 있다.** root에 chat 버튼을 더해
   root/folder/project 세 scope를 만들지 않는다. Library Reader에서 필요한 action은
   `학습 공간에서 질문`이며, 사용자가 Space를 고르고 `ProjectDocument` membership을
   명시적으로 추가한 뒤 그 Space로 이동한다. 숨은 Project 자동 생성은 금지한다.
3. **Index가 Research 기능처럼 보인다.** 현재의 진행률·취소·완료 구현은 재사용하되
   index의 UI ownership을 `Document`의 local capability로 승격한다. Source를 Space에
   넣었을 때 index가 없으면 로컬 background indexing을 시작할 수 있다. Reader와 메모는
   즉시 가능하고, Ask는 선택 source 전체가 retrieval-ready일 때만 가능하다. source를
   몰래 빼고 답하지 않는다.
4. **Global search가 본문 검색처럼 오해될 수 있다.** `라이브러리 검색`은 제목·태그·메모로
   문서를 찾는 기능이고, `학습 공간 검색`은 scope 안 PDF 본문을 `문서명 / p.27 /
   snippet`으로 찾는 기능으로 나눈다. 후자를 전역 Ctrl+K에 섞지 않는다.
5. **AI readiness가 서로 모순돼 보인다.** `AI 연결됨` 같은 단일 상태를 없앤다.
   예: `자료 질문 · Codex · 사용 가능`, `지식 자동 정리 · ChatGPT OAuth · 연결 필요`.
   Knowledge의 안내는 "지식 자동 정리에 ChatGPT 로그인이 필요합니다. 메모 수집·검토·Wiki와
   PDF 읽기에는 영향이 없습니다."로 구체화한다.
6. **Detached chat은 문맥이 없으면 빈 창이다.** 신규 primary entry를 제거하고 새 기능은
   BroadcastChannel에 의존하지 않는다. legacy route는 "이전 대화의 문맥을 불러오지
   못했습니다. 기존 대화는 보존됩니다. 새 질문은 학습 공간에서 시작해 주세요."와
   `학습 공간 열기`만 제공한다.
7. **색인 후 바뀌는 제목이 identity를 바꾸면 안 된다.** `Document.id`, 실제 path,
   SHA/revision, 표시 title, rename proposal을 분리한다. index 결과가 physical filename이나
   citation identity를 자동 변경해서는 안 된다.

## 정확한 목표 화면

기본은 `Sources | Reader | 메모 / 질문` 3-pane이며 중앙 Reader가 가장 넓다.

```text
Reactive Systems Study                         자료 4 · 검색 준비됨

Sources                         Reader                         메모 | 질문
+ 추가       질문에 사용 2/4   (기존 PDF Reader)             질문 자료 · 2개
☑ Paper A.pdf  준비됨                                         Paper A.pdf ×
☑ Patent B.pdf 준비됨                                         Patent B.pdf ×
☐ Review.pdf   검색 준비 중                                    [질문 입력] [Ask]
```

- `+ 추가`는 Library의 기존 Document를 선택해 `ProjectDocument`만 만든다. 파일과
  Document는 복제하지 않는다.
- Notes tab에서 선택 텍스트·highlight·현재 page/locator를 `StudyArtifactEvidence`로
  연결한다. Study Note를 Knowledge로 자동 승격하지 않는다.
- Ask tab은 선택 scope를 항상 보여 준다. checkbox 변경이나 입력만으로 AI 호출은 0회다.
- citation hover는 `문서명 · p.27`과 짧은 evidence preview를 보이고, click은 해당 PDF를
  열어 page/locator를 순간 강조한다. 우측 답변 상태는 유지한다.
- `답변 저장`을 사용자가 눌렀을 때만 `saved_answer`가 생긴다.

### 필수 empty/error copy

| 상황 | UI |
| --- | --- |
| Space source 0 | **이 학습 공간에 아직 자료가 없습니다** — 자료를 추가하면 읽기, 공간 검색, 하이라이트와 메모를 모두 로컬에서 사용할 수 있습니다. / 라이브러리에서 추가, PDF 추가 |
| Reader 미선택 | **읽을 자료를 선택하세요** — 왼쪽 Sources에서 문서를 선택하면 원문을 엽니다. |
| Ask source 0 | **질문에 사용할 자료를 선택하세요** — 왼쪽 Sources에서 체크한 자료만 질문에 사용됩니다. |
| index 진행 | **질문 자료를 검색 준비 중입니다** — 선택한 자료 1개가 준비 중입니다. 원문 읽기와 메모는 계속할 수 있습니다. |
| index 실패 | **이 PDF의 텍스트 검색 준비에 실패했습니다** — 원문 읽기와 주석은 계속 사용할 수 있습니다. |
| searchable text 없음 | **검색할 수 있는 텍스트를 찾지 못했습니다** — 원문 읽기와 주석은 계속 사용할 수 있습니다. OCR은 이번 버전에 포함되지 않습니다. |
| AI 미연결 | **AI가 연결되어 있지 않습니다** — PDF 읽기·검색·하이라이트·메모에는 영향이 없습니다. |
| evidence 없음 | **선택한 자료에서 이 답변을 뒷받침할 근거를 찾지 못했습니다.** |
| revision 변경 | **질문하는 동안 원문이 변경되었습니다. 이 답변의 근거를 현재 문서에 연결하지 않았습니다. 다시 질문해 주세요.** |
| Ask 실패 | **질문을 완료하지 못했습니다** — 로컬 자료와 메모는 변경되지 않았습니다. / 다시 시도 |

## 데이터·migration·privacy gate

기존 Project, ProjectDocument, Document, PDF Reader, local index,
annotation/highlight, Evidence locator taxonomy, Knowledge pipeline을 재사용한다.
P0 persistence 추가는 기존 합의의 세 종류로 제한한다.

1. `SourceScopeSnapshot`
2. `StudyArtifact(note | saved_answer)`
3. `StudyArtifactEvidence`

새 schema write보다 backup/recovery가 먼저다. migration은 additive·idempotent,
ID 불변, 첫 write 직전 safety snapshot, 최소 한 release dual-read/single-new-write,
legacy chat 자동 reparent 금지로 고정한다. portable backup, clean restore,
old-backup import, snapshot rollback, migration interruption을 통과하기 전에는 새
entity를 실제 사용자 DB에 쓰지 않는다.

Ask의 trusted flow는 다음뿐이다.

```text
사용자 Ask
→ spaceId + selected documentId[] + question 수신
→ ProjectDocument membership 재조회
→ 현재 Document SHA/revision/index revision 조회
→ SourceScopeSnapshot 생성
→ local retrieval
→ 최소 payload로 외부 AI 요청
→ citation document/revision/locator 검증
→ 검증 성공 시에만 grounded answer commit
```

외부 payload에는 질문, 선택 source에서 retrieval한 필요한 text, 최소 citation
metadata만 포함한다. absolute path, 비선택 source, 전체 Library, Knowledge, backup,
credential, diagnostic/stderr는 금지한다. renderer가 주입한 non-member `documentId`를
trusted backend/IPC가 거부하는 자동화 테스트가 필요하다.

## P0에서 하지 않을 것

Flashcard/Quiz, Study Guide/FAQ/briefing/mind map, audio/video overview, agentic web
research, 자동 웹 source 수집, collaboration, cloud sync, Knowledge 자동 승격,
Study Note → Wiki 직접 저장, OCR 전면 추가, vector DB 교체, source 자동 분류,
새 `study_spaces` table, Document 복제, folder→Study Space 자동 변환, legacy chat
자동 reparent, detached floating chat 개선, background AI, Space 열기/Source 추가 시
자동 AI 분석은 P0 범위가 아니다.

## 구현 묶음과 acceptance

### Gate 0 — Recovery & trust foundation

v1에서 시작한 library empty-state와 raw subprocess error 차단을 유지한다. 이어서
auto-backup lifecycle owner, detached-chat 신규 entry, recovery fixture를 실제 owner
file 기준으로 닫는다. schema write는 recovery gate 통과 전 금지한다.

### Bundle A — Offline Study Space & source boundary

`Project → StudySpace` adapter, `ProjectDocument → Sources`, 3-pane, Library에서 source
추가, row-open/Ask-checkbox 분리, local index 재사용, Space-local FTS, evidence-linked
Study Note, folder chat 신규 생성 봉인, legacy folder chat read-only, detached-chat 신규
entry 제거, capability별 AI readiness copy를 구현한다.

- A1: 새 `study_spaces` record 없이 Project identity를 쓴다.
- A2: 한 Document를 두 Space에 넣어도 Document는 하나이고 membership만 둘이다.
- A3: Source row를 열어도 Ask checkbox 상태는 바뀌지 않는다.
- A4: Source 0개에서는 chat/conversation record가 생성되지 않는다.
- A5: root/folder PDF의 Reader 기능은 같고 folder 존재 여부가 Ask capability를 정하지 않는다.
- A6: 기존 Library folder에서 새 folder chat을 만들 수 없다.
- A7: Space search의 모든 결과는 document·page/locator·snippet을 가지며 Reader로 이동한다.
- A8: index가 없거나 실패해도 Reader·annotation·note는 가능하고 상태가 보인다.
- A9: 네트워크 차단 상태에서 Sources, Reader, Reader/Space search, highlight, Study Note가 동작한다.
- A10: Note evidence가 올바른 Document와 locator로 다시 열린다.
- A11: Settings/Knowledge AI 상태는 capability 기준으로 모순되지 않는다.

### Bundle B — Grounded Ask & Saved Answer

Bundle A와 recovery/migration gate가 녹색일 때만 `SourceScopeSnapshot`, explicit Ask,
trusted membership validation, local retrieval, 최소 outbound payload, citation/revision
검증, Reader exact jump, `saved_answer`, Evidence를 구현한다.

- Ask 전 endpoint 요청 수는 0이다.
- scope 변경은 기존 snapshot을 수정하지 않고 새 snapshot을 만든다.
- non-member document, absolute path, 비선택 document text, Knowledge/credential/backup/
  diagnostic은 요청에 포함될 수 없다.
- 화면 citation은 모두 snapshot의 member source + revision + locator 검증을 통과해야 한다.
- revision이 바뀌면 stale 결과가 되고, evidence validation 실패 응답은 저장하지 않는다.
- 사용자가 저장을 눌렀을 때만 Saved Answer를 쓰며, 네트워크 없이도 다시 열고 유효한 citation은 Reader로 이동할 수 있다.

## 웹 UX 검토자에게 넘길 한 문장

**PageDock은 NotebookLM의 AI notebook을 복제하지 말고, 검증된 source-boundary와
citation loop를 기존 Project/Document/Reader/index/evidence 위에 얹는 local PDF study
workspace로 완성해야 한다. 우선순위는 Studio가 아니라 citation을 눌러 실제 PDF의
정확한 문장으로 즉시 복귀하는 경험이다.**
