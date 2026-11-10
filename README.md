# 1학년 춤 수행평가 – 협동 입력 (Netlify)

학생(심판)이 각자 폰/PC로 점수를 입력하고, 선생님이 한 번에 모아 엑셀 1~9반 시트에 채우는 구조입니다.
입력한 사람은 **자기가 입력한 점수만** 볼 수 있습니다.
명단(`netlify/functions/roster.mjs`)은 `1학년_춤_1_3_1.xlsm`의 1학년명렬에서 만들었습니다.

> 주의: Netlify "끌어다 놓기(Drop)"는 서버 기능(Functions)을 올리지 못합니다. 아래 A 또는 B 방법으로 올리세요.

## A. GitHub 연결 (명령어 없이)
1. github.com 에서 새 저장소를 만들 때 **반드시 `Private`(비공개)** 로 만드세요. (학생 명단이 들어 있습니다)
2. 이 폴더의 파일 전체를 저장소에 올립니다 (`Add file > Upload files`). `node_modules` 폴더는 올리지 않습니다.
3. Netlify > `Add new site` > `Import an existing project` > GitHub 저장소 선택. 설정은 그대로 두고 `Deploy`.
4. Netlify 사이트 설정 > `Environment variables` 에 추가 후 다시 배포(Deploys > Trigger deploy)
   - `ADMIN_KEY` : 선생님만 아는 긴 암호 (필수)
   - `ACCESS_CODE` : 수업 때 알려 줄 입장 코드 (선택)

## B. Netlify CLI
```
npm install
npm install -g netlify-cli
netlify login
netlify init
netlify env:set ADMIN_KEY 선생님만아는긴암호
netlify env:set ACCESS_CODE 수업때알려줄코드
netlify deploy --prod
```

## 학생마다 다른 입장 코드
학생마다 다른 6글자 코드가 `netlify/functions/roster.mjs` 안에 들어 있습니다(서버에서만 읽으며 화면으로 나가지 않습니다).
환경 변수 `PERSONAL_CODES` 를 `true` 로 만들고 배포하면 이 코드를 써야 입력할 수 있습니다. (`ADMIN_KEY` 와는 관계없습니다.)
- 코드 목록: `입장코드_목록.xlsx`(인쇄용) 또는 `https://내사이트주소/api/codes?key=ADMIN_KEY값` 에서 `entry-codes.csv` 로 받을 수 있습니다.
- 코드를 전부 새로 만들기: `python tools/make_roster.py 1학년_춤_1_3_1.xlsm --new-codes` → 새 `roster.mjs` 를 GitHub 에 올리면 적용됩니다. (이전 코드는 쓸 수 없게 됩니다)
- 명단만 바꾸기: 옵션 없이 같은 명령을 실행하면 기존 학생의 코드는 유지됩니다.
- **비공개(Private) 저장소에만** 올리세요. 코드가 파일에 들어 있습니다.

## 학생
사이트 주소 접속 → 반·번호·이름 입력 → `확인` → 평가할 조장 선택 → `불러오기` → 점수 입력 → `저장`.
(자기 조는 평가할 수 없습니다. 다시 저장하면 이전 점수가 새 점수로 바뀝니다.)

## 선생님: 점수 모으기
1. 주소창에 `https://내사이트주소/api/export?key=ADMIN_KEY값` 을 열고 나온 글자를 `scores.json` 으로 저장
2. 엑셀에 채우기 (`.xlsm` 은 매크로·확인 단추가 그대로 남습니다)
   ```
   python tools/fill_workbook.py scores.json 1학년_춤_1_3_1.xlsm 결과.xlsm
   ```
3. 결과 파일을 열면 1학년명렬 시트의 합계도 자동 계산됩니다.

점수 위치: 반 시트의 **행 = 조 시작행(1조 5, 2조 15, 3조 25, 4조 35) + 조원 순서(조장 먼저)**,
**열 = 입력한 학생의 칸(반 번호순 9칸씩) + 요소 순서(정확성, 리듬박자, 표현력, 팀워크, 동선, 활동성, 수행노력, 협업, 태도)**.

## 명단이 바뀌면 (엑셀 단추로 바로 올리기)
1. 기준이 되는 엑셀(`1학년_춤_1_3_1.xlsm`)의 1학년명렬 시트에서 명단·조를 고칩니다.
2. 1학년명렬의 **`명단서버에 올리기`** 단추를 누르고 관리자 암호(ADMIN_KEY)를 입력합니다.
3. 서버 명단과 비교한 결과(추가·삭제·조 변경·새 입장 코드·영향받는 점수)가 나오면 `예`를 누릅니다.
4. 몇 초 안에 사이트에 반영됩니다. GitHub 에 다시 올릴 필요가 없습니다.
- 기존 학생의 입장 코드는 그대로이고, 새 학생에게만 코드가 만들어집니다. (`…/api/codes?key=ADMIN_KEY값` 에서 확인)
- 서버에 올린 명단은 Netlify 저장소에 보관되며, 있으면 배포 파일의 `roster.mjs` 보다 **우선**합니다. (`roster.mjs` 는 처음 시작 값입니다.)
- 올릴 수 없는 명단: 한 조 8명 이상, 한 조에 조장 2명, 조가 1~4조가 아님, 같은 반·번호 중복, 빈 명단.
- 조 구성이 바뀌는 조에 **이미 저장된 점수가 있으면 어긋날 수 있으니**, 점수 입력 전에 명단과 조를 확정하세요.
- 여러 명이 쓸 때는 기준 파일을 하나만 정하세요. 마지막에 올린 명단이 전체를 덮어씁니다.

(명단 파일로 처음부터 다시 만들 때: `python tools/make_roster.py 1학년_춤_1_3_1.xlsm` — 기존 코드 유지, `--new-codes` 는 전부 새로 만듦. 이 경우 GitHub 에 올려야 하고, 서버에 올려 둔 명단이 있으면 그 명단이 우선합니다.)

## 알아둘 점
- 본인 확인은 반·번호·이름 일치뿐이라 `ACCESS_CODE` 를 쓰는 것이 좋습니다.
- 점수는 평가표의 값만 받습니다. 태도는 0~40 정수입니다.
- 평가가 끝나면 점수를 받아 둔 뒤 `ADMIN_KEY` 를 바꿔 두세요.
