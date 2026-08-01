export type HelpSectionId = 'library' | 'research' | 'knowledge' | 'settings';
export type HelpTabId = 'screen' | 'guide' | 'troubleshooting';

export interface HelpContentGroup {
  title: string;
  items: string[];
}

export interface ScreenHelpContent {
  eyebrow: string;
  title: string;
  summary: string;
  groups: HelpContentGroup[];
}

export const SCREEN_HELP: Record<HelpSectionId, ScreenHelpContent> = {
  library: {
    eyebrow: '라이브러리',
    title: 'PDF를 읽고 기록하는 곳',
    summary: '파일을 라이브러리에 넣고 검색·주석·개인 메모를 한곳에서 관리합니다.',
    groups: [
      { title: '처음 할 일', items: ['왼쪽 폴더에서 PDF를 선택하거나 PDF 추가로 라이브러리에 넣습니다.', 'PDF를 열면 페이지 위에 하이라이트와 메모를 남길 수 있습니다.', '파일 이름이나 폴더를 바꿀 때는 PageDock 안의 이름 변경 기능을 사용하세요.'] },
      { title: '작은 팁', items: ['상단 검색은 파일명·요약·개인 메모를 함께 찾습니다.', 'AI 없이도 PDF 읽기, 검색, 하이라이트와 메모는 계속 사용할 수 있습니다.', '설정의 백업에서 연구 데이터와 지식 저장소를 휴대용 ZIP으로 보관하세요.'] },
    ],
  },
  research: {
    eyebrow: '리서치',
    title: '자료를 프로젝트 단위로 조사하는 곳',
    summary: '논문·특허·공개 자료를 프로젝트에 연결하고 근거가 보이는 분석을 만듭니다.',
    groups: [
      { title: '처음 할 일', items: ['프로젝트를 만든 뒤 PDF, DOI, 논문 검색 결과 또는 특허번호를 추가합니다.', '왼쪽 검색에서 제목·본문·청구항·개인 메모를 빠르게 찾습니다.', '분석할 문서와 프로필을 선택한 뒤 AI 분석은 필요할 때만 실행합니다.'] },
      { title: '작은 팁', items: ['AI 분석 결과는 원문 근거·도면 해석·기술적 추정·불확실을 구분해 확인하세요.', '공개 PDF 다운로드는 사용자가 승인한 뒤에만 라이브러리에 복사됩니다.', 'API 키가 없어도 로컬 PDF 검색과 수동 자료 추가는 사용할 수 있습니다.'] },
    ],
  },
  knowledge: {
    eyebrow: '지식 정리',
    title: '메모를 개인 위키로 다듬는 곳',
    summary: '아무렇게나 쓴 메모를 수집하고, Codex가 제안한 변경을 확인한 뒤 위키에 반영합니다.',
    groups: [
      { title: '처음 할 일', items: ['메모를 붙여 넣거나 txt·md 파일을 넣어 수집함에 보냅니다.', '정리 버튼을 누르면 AI가 새 주제·업데이트·충돌 변경안을 제안합니다.', '변경안을 diff로 확인하고 직접 고친 뒤 승인해야 현재 위키가 바뀝니다.'] },
      { title: '작은 팁', items: ['원본 메모는 자동으로 덮어쓰지 않습니다. 충돌은 별도 목록으로 남습니다.', 'revision 복원은 과거 내용을 지우지 않고 새 revision을 만듭니다.', '메모 폴더를 연결하면 지식 화면 진입 또는 새로고침 때 새 txt·md 파일을 수집합니다.'] },
    ],
  },
  settings: {
    eyebrow: '설정',
    title: 'PageDock의 연결과 보관을 조정하는 곳',
    summary: '라이브러리 위치, AI 연결, PDF 도구, 백업을 확인합니다.',
    groups: [
      { title: '처음 할 일', items: ['라이브러리 위치를 바꾸기 전에 기존 폴더를 백업하세요.', 'Codex를 연결하면 브라우저 OAuth로 로그인하고 API 키를 입력하지 않습니다.', '원본 PDF 하이라이트 반영이 필요할 때만 PDF 도구를 준비합니다.'] },
      { title: '작은 팁', items: ['로그인 오류가 나도 로컬 문서와 지식 기능은 계속 사용할 수 있습니다.', '백업 ZIP에는 지식 저장소와 revision 휴지통이 포함되며 로그인 토큰은 포함되지 않습니다.', '설치 파일의 업데이트와 개인 라이브러리 데이터는 서로 분리되어 있습니다.'] },
    ],
  },
};

export const GENERAL_HELP: HelpContentGroup[] = [
  { title: '기본 흐름', items: ['라이브러리에서 자료를 읽고 메모합니다.', '리서치에서 자료를 프로젝트와 근거에 연결합니다.', '지식 정리에서 흩어진 메모를 검토형 개인 위키로 정리합니다.', '설정에서 AI 연결·라이브러리 위치·백업을 관리합니다.'] },
  { title: 'AI 사용 원칙', items: ['AI는 제안만 만들고 승인 전에는 위키를 바꾸지 않습니다.', '지식 정리는 ChatGPT OAuth로 로그인한 Codex만 사용합니다.', 'AI를 사용하지 않아도 PDF·검색·메모·위키 열람은 동작합니다.'] },
  { title: '데이터 원칙', items: ['원본 메모와 위키 revision은 보존됩니다.', '현재 revision은 휴지통으로 보낼 수 없습니다.', '정기적으로 휴대용 ZIP 백업을 만들어 다른 Windows PC에서도 복원할 수 있게 하세요.'] },
];

export const TROUBLESHOOTING_HELP: HelpContentGroup[] = [
  { title: 'Codex·OAuth 오류', items: ['지식 화면의 로그인 상태 확인을 누르고 필요하면 ChatGPT 다시 연결을 선택하세요.', '오류가 나도 자동 로그아웃하지 않으며, 원본 메모는 다시 정리할 때까지 남아 있습니다.', 'API key 인증은 지식 정리에 사용할 수 없습니다.'] },
  { title: 'AI 정리 중단', items: ['현재 작업 후 중지는 진행 중인 메모를 마친 뒤 batch를 멈춥니다.', '즉시 취소는 진행 중인 Codex 실행을 취소하고 메모를 수집함으로 되돌립니다.', '실패한 메모는 다시 정리를 눌렀을 때만 재시도합니다.'] },
  { title: '충돌·revision 복구', items: ['충돌은 현재 위키를 자동으로 덮어쓰지 않습니다. 충돌 근거를 확인하고 직접 수정하세요.', '과거 revision 복원은 현재 상태를 새 revision으로 남깁니다.', '휴지통의 revision은 되돌릴 수 있으며, 영구 삭제만 복구할 수 없습니다.'] },
  { title: '백업·복원', items: ['복원 전 PageDock은 안전 snapshot을 먼저 만듭니다.', '다른 PC에서 복원할 때 라이브러리 경로가 달라도 문서 ID와 연구 관계를 재연결합니다.', '백업 오류가 의심되면 원본 라이브러리 폴더를 별도로 복사한 뒤 다시 시도하세요.'] },
];
