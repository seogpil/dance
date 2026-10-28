# 1학년 춤 수행평가 – 협동 입력 (Netlify)

학생(심판)이 각자 폰/PC로 점수를 입력하고, 선생님이 한 번에 모아 엑셀 1~9반 시트에 채우는 구조입니다.
입력한 사람은 **자기가 입력한 점수만** 볼 수 있습니다.
명단(`netlify/functions/roster.mjs`)은 `1학년_춤_1_1.xlsm`의 1학년명렬에서 만들었습니다.

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

## 학생
사이트 주소 접속 → 반·번호·이름 입력 → `확인` → 평가할 조장 선택 → `불러오기` → 점수 입력 → `저장`.
(자기 조는 평가할 수 없습니다. 다시 저장하면 이전 점수가 새 점수로 바뀝니다.)

## 선생님: 점수 모으기
1. 주소창에 `https://내사이트주소/api/export?key=ADMIN_KEY값` 을 열고 나온 글자를 `scores.json` 으로 저장
2. 엑셀에 채우기 (`.xlsm` 은 매크로·확인 단추가 그대로 남습니다)
   ```
   python tools/fill_workbook.py scores.json 1학년_춤_1_1.xlsm 결과.xlsm
   ```
3. 결과 파일을 열면 1학년명렬 시트의 합계도 자동 계산됩니다.

점수 위치: 반 시트의 **행 = 조 시작행(1조 5, 2조 15, 3조 25, 4조 35) + 조원 순서(조장 먼저)**,
**열 = 입력한 학생의 칸(반 번호순 9칸씩) + 요소 순서(정확성, 리듬박자, 표현력, 팀워크, 동선, 활동성, 수행노력, 협업, 태도)**.

## 명단이 바뀌면
`python tools/make_roster.py 1학년_춤_1_1.xlsm` 실행 후 다시 올리세요(GitHub 에 파일을 덮어쓰면 자동 배포).

## 알아둘 점
- 본인 확인은 반·번호·이름 일치뿐이라 `ACCESS_CODE` 를 쓰는 것이 좋습니다.
- 점수는 평가표의 값만 받습니다. 태도는 0~40 정수입니다.
- 평가가 끝나면 점수를 받아 둔 뒤 `ADMIN_KEY` 를 바꿔 두세요.
