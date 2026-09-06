# PageDock v2 최종 개발 지시서 — 2026-08-31

## 최종 결론

> **PageDock은 하나의 학습 공간 안에서 선택한 로컬 자료를 읽고, 찾고,
> 표시하고, 메모하며, 사용자가 요청할 때만 그 자료 범위에서 검증 가능한 근거를
> 가진 답을 얻고 다시 원문으로 돌아가는 Windows 개인 공부·기술 리서치 도구다.**

v2의 단일 우선순위는 사용자가 이해하는 공부 자료의 경계와 검색·메모·AI·citation이
실제로 사용하는 데이터 경계를 일치시키는 것이다. NotebookLM에서 가져올 것은
`notebook = source boundary`, 명시적 자료 선택, source-only 답변, citation으로
원문 복귀, 보존 가능한 note의 패턴이다. Studio, 자동 웹 수집·조사, collaboration,
cloud sync, audio/video, background AI는 복제하지 않는다.

## 변경 불가 계약

```text
Study Space identity = existing Project.id
Source membership    = existing ProjectDocument (Project ↔ Document M:N)
Document             = global original identity
```

- Study Space는 제품/UI 용어일 뿐 새 저장 root/table이 아니다.
- 새 `study_spaces` table, Project/Document 복제, Project ID 변경, Knowledge 이동,
  AnalysisReport/Evidence polymorphic 재작성은 P0에서 금지한다.
- Knowledge는 현재의 수집함 → 검토함 → 충돌함 → wiki 장기 지식 흐름으로 남는다.
  Study Note/Saved Answer는 학습 공간의 수정 가능한 작업 기억이며 P0에서 Knowledge로
  자동 승격하거나 직접 저장하지 않는다.
- Reader에서 문서를 열거나 folder에 문서가 있거나 검색 결과에 나타난 사실은 AI scope가
  아니다. 오직 해당 Space의 실제 `ProjectDocument` member 중 사용자가 체크한
  `documentId[]`만 Ask source다.

## 정보 구조와 우선순위

최종 primary navigation은 **학습 공간 / 라이브러리 / 지식**이다. Research route와
deep link는 최소 한 release 동안 호환 경로로 보존하고, 이후 학습 공간의
`더보기 → 고급 리서치`로만 노출한다.

| 지금 | 다음(P1) | P0 제외 |
| --- | --- | --- |
| Project 기반 Study Space, source checkbox, source-local FTS, evidence-linked Study Note, verified citation Reader jump, Saved Answer | AI 없는 Source Overview, Learning Guide 응답 방식, highlight/Saved Answer 기반 복습·진행률, source labels | Quiz/flashcard 생성, Studio/briefing/mindmap/audio/video, agentic web research, 자동 수집, cloud/collaboration, OCR/벡터 DB 전면 교체, 자동 AI |

## 화면 계약

Study Space 기본 화면은 `Sources | Reader | 메모 / 질문` 3-pane이고 중앙 Reader가
가장 넓다. Source row click은 Reader 열기, checkbox만 Ask scope 변경이다.

- 1280–1439 logical px: Sources 176–240px(기본 200), Reader 최소 640px, Right pane
  280–340px(기본 300), gutter 8–12px, root horizontal scroll 금지.
- 1440px 이상: Sources 240px / Reader flex / Right 360px.
- 1280px 미만: Reader를 보전하고 source는 접거나 right pane을 drawer로 전환한다.
- PDF 본문 실사용 높이는 720px viewport에서 약 500px 이상 남긴다.

필수 copy:

| 상태 | 제목 | 설명/행동 |
| --- | --- | --- |
| Source 0 | 이 학습 공간에 아직 자료가 없습니다 | 자료를 추가하면 읽기, 공간 검색, 하이라이트와 메모를 모두 로컬에서 사용할 수 있습니다. / 라이브러리에서 추가, PDF 추가 |
| Reader 미선택 | 읽을 자료를 선택하세요 | 왼쪽 Sources에서 문서를 선택하면 원문을 엽니다. |
| Ask source 0 | 질문에 사용할 자료를 선택하세요 | 왼쪽 Sources에서 체크한 자료만 질문에 사용됩니다. |
| index 진행 | 질문 자료를 검색 준비 중입니다 | 선택한 자료가 준비 중입니다. 원문 읽기와 메모는 계속할 수 있습니다. |
| index 실패 | 이 PDF의 텍스트 검색 준비에 실패했습니다 | 원문 읽기와 주석은 계속 사용할 수 있습니다. |
| AI 미연결 | AI가 연결되어 있지 않습니다 | PDF 읽기·검색·하이라이트·메모에는 영향이 없습니다. |
| evidence 없음 | 선택한 자료에서 이 답변을 뒷받침할 근거를 찾지 못했습니다. | 일반지식 fallback 없이 정상 결과로 끝낸다. |
| revision 변경 | 질문하는 동안 원문이 변경되었습니다. | 이 답변의 근거를 현재 문서에 연결하지 않았습니다. 다시 질문해 주세요. |

Library folder는 문서 정리만 담당한다. Folder Chat 신규 생성은 봉인하고 기존
folder chat은 read-only compatibility 경로로 보존한다. root PDF에 folder chat을
추가하지 않는다. Library에서 질문이 필요하면 사용자가 `학습 공간에서 질문`을 눌러
Space를 고르고 `ProjectDocument` membership을 명시적으로 만든 뒤 이동한다.

## 데이터·복구·privacy gate

P0에서 추가 가능한 persistence는 아래 세 종류뿐이다.

1. `SourceScopeSnapshot`: turn마다 immutable한 `spaceId`, 선택 source와
   SHA/revision/index revision/timestamp를 보존한다.
2. `StudyArtifact`: `note | saved_answer`만 허용한다.
3. `StudyArtifactEvidence`: artifact와 검증된 원문 locator를 연결한다.

새 schema write 전에 portable backup, clean restore, old-backup import, safety
snapshot rollback, migration interruption을 자동화한다. migration은 additive,
idempotent, existing ID 불변, first write 직전 snapshot, 최소 한 release
dual-read/single-new-write를 지킨다. legacy chat을 어떤 Space에 속한다고 추측해
reparent하지 않는다.

Ask는 사용자가 누른 경우에만 외부 호출한다. trusted backend/IPC가 `ProjectDocument`
membership을 재조회하고, 현재 source revision을 고정한 뒤 local retrieval의 최소
chunk만 보낸다. 절대 path, 비선택 source, 전체 Library, Knowledge, backup, credential,
diagnostic/stderr는 payload에 포함하면 안 된다. citation은 documentId, source revision,
page/section/figure locator, quote/chunk, evidence type을 모두 검증해야 하며 source가
변경되면 stale로 끝낸다.

## 구현 순서

1. **Recovery gate**: old-data fixture, backup/import/restore/rollback/migration
   interruption green. 실패 시 새 schema write 금지.
2. **Trust foundation**: populated-library empty state와 Reader raw error는 이미
   수정했으므로 regression으로 고정한다. automatic backup의 app-lifecycle owner와
   detached-chat 신규 진입/이동 문맥을 정리한다.
3. **Domain/persistence**: Project→StudySpace adapter 및 세 additive entity와 backup
   serializer를 함께 구현한다.
4. **Offline Study Space**: Sources/Reader/Notes/local FTS/evidence link를 네트워크와
   AI 없이 유용하게 완성한다.
5. **Grounded Ask**: immutable scope, membership validation, local retrieval, citation
   verification/stale, Reader jump을 구현한다.
6. **Saved Answer**: 명시적 저장과 offline 재열기/citation navigation을 구현한다.
7. **IA 전환**: parity 뒤 학습 공간/라이브러리/지식으로 primary nav를 전환한다.

## 지금 구현할 묶음 — Trust lifecycle hardening

현재 빈 상태와 raw reader error는 완료된 회귀 대상이다. 이번 구현은 다음 두
신뢰성 결함만 닫는다.

1. **Automatic backup owner 이동**
   - `src/app/page.tsx`의 page-mount backup effect를 제거한다.
   - `src/components/common/AutomaticBackupScheduler.tsx`를 app-root singleton으로
     만들고 `src/app/layout.tsx`에서 한 번만 mount한다.
   - 24시간 due 판단은 순수 helper `src/lib/automatic-backup.ts`로 분리해 테스트한다.
   - route 전환이나 PDF 선택이 backup job을 새로 만들지 않아야 한다.
2. **Detached chat 신규 진입 및 moving context 봉인**
   - `src/components/layout/Topbar.tsx`의 popup entry와 `src/app/page.tsx`의
     BroadcastChannel publisher를 제거한다.
   - `src/app/chat-window/page.tsx`는 BroadcastChannel로 메인 창 context를 기다리지
     않는다. query에 완전한 legacy context가 있을 때만 기존 대화를 열고, 없으면
     빈 화면 대신 명확한 recovery 안내와 PageDock으로 돌아가는 링크를 보인다.
   - existing conversation data를 삭제하거나 reparent하지 않는다.

### 이번 묶음 acceptance

- root layout에는 scheduler가 정확히 한 번 mount되고 page route에는 backup timer가 없다.
- 직전 backup이 24시간 미만이면 request가 없고, 24시간 이상이면 단 한 번만 실행한다.
- 페이지/route 50회 이동이 additional backup scheduling owner를 만들지 않는다.
- Topbar와 main page에 `/chat-window` popup 또는 `BroadcastChannel` moving-context
  publisher가 없다.
- context 없는 legacy chat route는 raw/blank 상태가 아니라 설명과 복귀 action을 보인다.
- `npm test`, lint, TypeScript, docs check가 통과한다.

## P0 완료 기준

P0의 하나의 완결 흐름은 다음이다.

```text
학습 공간 열기 → Sources 선택 → Reader에서 읽기 → local search → highlight/note
→ Ask source를 명시 선택 → Ask → 검증 citation으로 원문 복귀 → Saved Answer 저장
```

오프라인/AI 없는 상태에서도 Space, Sources, Reader, annotation/highlight, local FTS,
Study Note, 기존 Saved Answer 열기와 citation navigation, Library search, backup/export/
restore가 동작해야 한다.
