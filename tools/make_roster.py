"""1학년명렬 시트 -> netlify/functions/roster.mjs (서버 전용 명단, 화면으로 직접 내려가지 않음)
사용: python tools/make_roster.py 엑셀파일.xlsx"""
import sys, json, openpyxl, warnings
warnings.filterwarnings('ignore')
src = sys.argv[1]
ws = openpyxl.load_workbook(src, data_only=True)['1학년명렬']
rows = []
for r in range(2, ws.max_row + 1):
    cls, no, name, lead, grp = (ws.cell(r, c).value for c in (2, 3, 4, 5, 6))
    if not (isinstance(cls, int) and isinstance(no, int) and name):
        continue
    g = grp if isinstance(grp, int) else None
    rows.append({"cls": cls, "no": no, "name": str(name).strip(), "group": g,
                 "leader": bool(g and lead == g)})
with open('netlify/functions/roster.mjs', 'w', encoding='utf-8') as f:
    f.write('// make_roster.py 로 만든 파일입니다. 1학년명렬 행 순서 그대로입니다.\n')
    f.write('export default ' + json.dumps(rows, ensure_ascii=False, indent=0) + ';\n')
print(len(rows), 'students')
