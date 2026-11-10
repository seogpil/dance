"""1학년명렬 시트 -> netlify/functions/roster.mjs (서버 전용 명단 + 학생별 입장 코드)
사용:  python tools/make_roster.py 엑셀파일.xlsm              (명단 갱신, 기존 입장 코드는 유지)
       python tools/make_roster.py 엑셀파일.xlsm --new-codes  (입장 코드를 전부 새로 만듦)
"""
import sys, json, re, secrets, openpyxl, warnings
warnings.filterwarnings('ignore')
CHARS = "23456789abcdefghjkmnpqrstuvwxyz"          # 헷갈리는 0,o,1,l,i 제외
new_codes = '--new-codes' in sys.argv
src = [a for a in sys.argv[1:] if not a.startswith('--')][0]
OUT = 'netlify/functions/roster.mjs'

old = {}
try:
    txt = open(OUT, encoding='utf-8').read()
    for s in json.loads(txt[txt.index('export default ') + 15:].rstrip().rstrip(';')):
        if s.get('code'): old[(s['cls'], s['no'])] = s['code']
except Exception:
    pass

ws = openpyxl.load_workbook(src, data_only=True)['1학년명렬']
rows = []
for r in range(2, ws.max_row + 1):
    cls, no, name, lead, grp = (ws.cell(r, c).value for c in (2, 3, 4, 5, 6))
    if not (isinstance(cls, int) and isinstance(no, int) and name):
        continue
    g = grp if isinstance(grp, int) else None
    code = None if new_codes else old.get((cls, no))
    code = code or ''.join(secrets.choice(CHARS) for _ in range(6))
    rows.append({"cls": cls, "no": no, "name": str(name).strip(), "group": g,
                 "leader": bool(g and lead == g), "code": code})
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// make_roster.py 로 만든 파일입니다. 서버 전용(화면으로 내려가지 않음). 비공개 저장소에만 올리세요.\n')
    f.write('export default ' + json.dumps(rows, ensure_ascii=False, indent=0) + ';\n')
print(len(rows), 'students', '(입장 코드 새로 생성)' if new_codes else '(기존 입장 코드 유지)')
