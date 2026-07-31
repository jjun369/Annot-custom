# PageDock macOS 친구 테스트 안내

이 파일은 M1 이후 Apple Silicon Mac에서 PageDock 0.4.1 비공개 테스트판을 실행하기 위한 안내입니다. 현재 빌드는 Apple Developer ID로 서명·공증되지 않았으므로 지인 테스트에만 사용하고 공개 배포하지 않습니다.

## 전달할 파일

`PageDock-0.4.1-mac-arm64.dmg` 하나만 전달하면 됩니다.

- 크기: 109.6MB
- SHA-256: `A83ED26B6DA3C87C4AB3E8C05F648A2DE86F406DE6436E43CE5112004F868807`
- 대상: M1 이후 Apple Silicon Mac
- 권장 macOS: Monterey 12 이상

ZIP은 자동 업데이트와 진단을 위한 보조 산출물이므로 일반 설치에는 필요하지 않습니다.

## 설치와 첫 실행

1. DMG를 열고 `PageDock`을 `Applications` 폴더로 끌어 놓습니다.
2. Applications에서 PageDock을 실행합니다.
3. macOS가 개발자를 확인할 수 없다고 차단하면 `시스템 설정 → 개인정보 보호 및 보안`을 엽니다.
4. 차단된 PageDock 항목의 `확인 없이 열기` 또는 `그래도 열기`를 선택합니다.
5. 출처를 확인한 뒤에만 실행을 승인합니다.
6. Documents 폴더 접근 요청이 나타나면 PageDock Library를 사용하기 위해 허용합니다.

앱이 서명되지 않았다는 경고를 없애는 터미널 명령은 안내하지 않습니다. 반드시 macOS의 공식 보안 설정 화면에서 한 번만 직접 승인합니다.

## Codex와 지식 정리

1. PageDock 설정의 `AI 연결`에서 Codex 상태를 확인합니다.
2. Codex가 없으면 `공식 설치 안내`를 열어 공식 Codex 앱 또는 CLI를 설치합니다.
3. `다시 확인`을 누릅니다.
4. `브라우저 로그인`을 눌러 ChatGPT OAuth를 완료합니다.
5. 지식 화면에서 로그인 상태를 다시 확인합니다.

지식 정리는 API 키 인증을 허용하지 않습니다. AI 처리 전에 서버가 ChatGPT OAuth인지 다시 검증하며, 오류가 나도 PageDock이 자동으로 로그아웃하지 않습니다.

## PDF 도구

PDF 읽기, 메모와 지식 위키는 Python 없이 사용할 수 있습니다. 원본 PDF에 하이라이트를 반영하려면:

1. 설정의 `PDF 하이라이트 도구` 상태를 확인합니다.
2. Python이 없다면 `Python 설치 안내`를 사용합니다.
3. Python 설치 후 `다시 확인`, `자동 준비`를 차례로 누릅니다.
4. PyMuPDF는 PageDock 사용자 설정 폴더의 전용 가상 환경에 설치됩니다.

## 친구에게 부탁할 확인 항목

- DMG 열기와 Applications 복사가 되는지
- 보안 설정에서 한 번 승인한 뒤 정상 재실행되는지
- 창을 닫고 Dock 아이콘을 눌렀을 때 다시 열리는지
- `Command+C`, `Command+V`, `Command+A`, `Command+W`, `Command+Q`가 자연스러운지
- 한글·공백이 있는 PDF를 추가하고 다시 열 수 있는지
- PDF 읽기·검색·메모가 되는지
- Codex ChatGPT OAuth 로그인과 지식 정리 한 건이 되는지
- AI 오류 후에도 로컬 메모와 위키를 계속 볼 수 있는지
- 지식 리비전 휴지통과 복원이 되는지
- 앱을 종료한 뒤 불필요한 PageDock 프로세스가 남지 않는지

오류를 전달할 때 개인 메모, PDF 원문, OAuth 파일 또는 Keychain 내용을 보내지 않습니다. macOS 버전, Mac 칩, 어느 버튼에서 어떤 오류 문구가 나왔는지만 기록하면 됩니다.
