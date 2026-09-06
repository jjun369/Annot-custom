# DeepSeek·웹 UX 병렬 재검토 — Trust lifecycle 후속

검토 일시: 2026-08-31  
검토 자료: 실제 동작으로 다시 캡처한 Library, Reader, legacy detached chat, folder chat, Research, Knowledge 화면 6장. Settings·경로·계정 정보는 공유하지 않았다.

## 확정 결론

다음 작업은 새 Study Space, 새 스키마, 새 AI 기능이 아니다. **V2-01B — Legacy AI Surface Honesty**만 구현한다.

- Folder는 라이브러리 정리 단위일 뿐 AI 출처 경계가 아니다.
- 기존 folder conversation은 삭제·이전하지 않고, 읽기 전용 호환 기록으로만 남긴다.
- AI가 등장하는 모든 표면에는 출처 범위를 문장으로 표시한다.
- Knowledge의 로컬 capture/review는 OAuth 없이 완결되어야 하며, OAuth 안내는 사용자가 `AI로 정리`를 실행했을 때만 표시한다.
- Reader의 raw 오류 차단은 완료로 유지하고, generic capability notice의 줄바꿈/폭만 고친다.

이 결론은 DeepSeek과 웹 UX 검토자의 공통 의견이다. 현재 고정 계약도 변경하지 않는다: `Project.id`는 Study Space의 identity, `ProjectDocument`는 Sources membership, `Document`는 전역 원본, Knowledge는 별도 장기 지식, 외부 AI는 Ask 시에만 최소 source payload로 호출한다.

## 캡처별 판정

| 캡처 | 판정 | 다음 조치 |
| --- | --- | --- |
| Library: PDF가 있지만 미선택 | 완료 | `읽을 문서를 선택하세요` 상태를 회귀 테스트로 고정 |
| Reader: generic text-analysis failure | 부분 완료 | raw stderr/path는 유지 차단, notice를 최대 2줄 responsive 상태로 수정 |
| Detached chat recovery | 완료 | 새 구현 대신 keyboard/focus 회귀 테스트만 추가 |
| PDF 0개 folder + 연구 대화 | 미해결, 최우선 | 새 대화 진입 제거, 기존 기록 read-only + provenance 표시 |
| Research Project/Document registry | 유지 | 이번 묶음에서 수정하지 않음; 이후 Study Space adapter의 원천으로 사용 |
| Knowledge OAuth 배너 | 미해결 | 영구 배너 제거, AI action 직후에만 연결 안내 |

## 두 검토자의 공통 지적

1. **0개 소스인데 대화가 있는 상태가 가장 큰 신뢰 훼손이다.** 사용자에게 folder가 AI의 source boundary처럼 보이지만 실제 계약은 그렇지 않다.
2. **Local-first는 로컬 기능을 외부 OAuth가 막지 않는다는 뜻이다.** Knowledge의 수동 capture·inbox·review는 언제나 가능해야 한다.
3. **Reader failure는 PDF 열람 실패로 읽히면 안 된다.** 텍스트 분석만 제한되고 PDF 열람·검색·하이라이트·메모는 계속 가능함을 좁은 안내로 보인다.
4. **NotebookLM에서 지금 가져올 것은 생성 기능이 아니라 visible source provenance다.** 답변/대화 근처에 어떤 출처 경계인지 항상 보인다.

## V2-01B 작업 지시

### 수정 대상

- `src/components/workspace/FolderView.tsx`
- 실제 folder chat 진입을 제어하는 현재 owner (필요하면 `src/app/page.tsx`)
- `src/app/knowledge/page.tsx`
- `src/components/workspace/PdfViewer.tsx`
- 관련 테스트

### 구현 규칙

1. Folder의 신규 `폴더 연구 대화`/새 대화 CTA를 PDF 수와 관계없이 제거한다.
2. 기존 conversation row는 데이터 변경 없이 다음 의미를 명확히 보인다.

   > 이전 대화 · 읽기 전용  
   > 이 대화는 기존 폴더 방식으로 만들어졌으며 현재 Sources와 연결되지 않습니다.

   클릭은 과거 열람만 허용한다. composer, retry-as-new-chat, 현재 folder PDF를 과거 출처처럼 표시하는 동작은 금지한다.
3. legacy 대화 표면의 accessible name에도 `현재 Sources와 연결되지 않음` 의미가 포함되어야 한다.
4. Knowledge 메인 화면의 영구 `ChatGPT OAuth 필요` 카드를 제거한다. `AI로 정리`를 명시 실행했고 미연결일 때만 다음 안내를 표시한다.

   > AI 연결이 필요합니다  
   > AI 정리는 선택 기능입니다. 현재 메모는 로컬에 저장되어 있으며, 연결하지 않아도 수집·검토·충돌 확인·위키를 사용할 수 있습니다.

5. Reader notice는 최대 두 줄, Reader 폭 안에서 wrap, raw traceback/details 없음으로 제한한다.

   > 일부 텍스트 분석 기능을 사용할 수 없습니다.  
   > PDF 열람·검색·하이라이트·메모는 계속 사용할 수 있습니다.

### Acceptance criteria

- PDF 0개/1개 이상 folder 모두 신규 Folder Chat CTA가 없다.
- legacy 대화의 row 수와 데이터는 변경되지 않으며 read-only/provenance 텍스트가 색상 외 방식으로도 보인다.
- legacy 대화에서 새 질문 입력이나 새 session 생성이 불가능하다.
- Knowledge capture → local save → inbox/review는 OAuth·외부 AI 요청 없이 동작한다.
- OAuth 안내는 `AI로 정리` action 뒤에만 나타나며 dialog는 Esc close와 focus return을 지원한다.
- 1280×720 및 150%/200% scaling에서 Reader notice가 clip되거나 root horizontal scrollbar를 만들지 않는다.
- Library unselected, raw error sanitization, detached recovery는 regression test로 유지한다.
- DB/schema, Project/Document/Knowledge persistence, backup format, Research, AI backend, navigation IA는 이 묶음에서 변경하지 않는다.

## 의견 차이와 최종 선택

DeepSeek은 local parser failure 시 수동 OCR 같은 대안을 더 전면에 두자는 쪽이었다. 웹 UX 검토자는 현재 Reader 검색이 살아 있고 raw 오류도 제거되었으므로 기능 확장은 다음 단계로 미루고 표시만 고치자고 했다. **후자를 채택한다.** 이번 묶음은 정확한 출처 경계와 optional AI의 정직한 표시에 한정한다.

DeepSeek은 Knowledge의 OAuth 문제를 local-first 위반으로 강하게 지적했고, 웹 UX 검토자도 같은 변경을 이번 묶음에 넣어야 한다고 판단했다. 이 항목은 cosmetic이 아니라 제품 계약을 화면에 맞추는 신뢰성 수정으로 확정한다.

## 지금 하지 않는 것

- 새 `study_spaces` table 또는 Project/Document 복제
- old chat의 추측 reparent/migration
- 일반 지식 fallback, 자동 AI, background upload
- cloud sync/collaboration
- Study Space 3-pane, 새 Ask, citation backend, 검색 재설계
- Reader 엔진/파서/OCR 기능 확장

V2-01B가 끝난 뒤에만 기존 순서대로 `Project.id → Study Space adapter`와 offline `Sources | Reader | Notes` shell로 진행한다.
