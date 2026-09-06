# Trust lifecycle 후속 화면 캡처 메모 — 2026-08-31

이번 세트는 v2 지시서의 첫 Trust lifecycle 구현 직후, 별도 임시 PageDock Library에서
실제 클릭으로 재현했다. Settings 화면은 계정/환경 맥락이 있어 외부 리뷰에서 제외한다.

| 캡처 | 실제 확인 상태 | 리뷰 쟁점 |
| --- | --- | --- |
| `00-library-unselected-after-trust.png` | Library에 PDF 1개가 있지만 선택하지 않은 상태 | empty library와 unselected PDF의 copy가 분리되어 regression으로 고정돼야 한다. |
| `01-reader-after-trust.png` | 2-page sample PDF의 Reader, reader search/annotation controls, generic text-analysis notice | Reader는 원문 중심으로 계속 동작하고 raw Python/stderr가 보이지 않는다. |
| `02-legacy-detached-context-recovery.png` | `/chat-window`을 문맥 없이 직접 열기 | moving BroadcastChannel context 대신 명확한 legacy recovery copy와 PageDock 복귀 action을 보여 준다. |
| `03-folder-chat-current-state.png` | PDF 0개인 `UX Review Sources` folder에 과거 대화 1개와 `폴더 연구 대화` action이 있는 상태 | source boundary 혼동의 가장 선명한 사례다. 현재 chat 생성 흐름은 Study Space P0에서 봉인해야 한다. |
| `04-research-after-trust.png` | Research의 전체 자료와 Project `Reactive Systems Study`가 분리되어 보이는 상태 | Document의 local index capability와 Study Space의 Source membership을 Research UI에서 분리해 재사용해야 한다. |
| `05-knowledge-after-trust.png` | Knowledge capture/review pipeline과 `ChatGPT OAuth 필요` 안내 | Knowledge는 보존하되 Study Note와 병합하지 않는다. 자료 질문(Codex)과 지식 정리(OAuth)의 capability 상태를 분리해 표현해야 한다. |

외부 검토에 함께 전달할 불변 계약:

```text
Study Space identity = existing Project.id
Sources              = ProjectDocument membership → global Document
Knowledge            = review pipeline을 거친 장기 지식 (Study Note와 별개)
Ask                  = 명시 버튼만, backend membership/revision/citation 검증
```

이번 캡처는 새 Study Space UI가 완성됐다는 증거가 아니다. 반대로, 왜 폴더/Project/
Chat/Knowledge를 각각 source boundary로 유지할 수 없는지와, v2의 offline-first
Study Space가 필요한 이유를 검증하는 자료다.
