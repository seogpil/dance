"""관리자 취합: /api/export 로 받은 scores.json 을 1~9반 시트의 정확한 칸에 써 넣습니다.

사용:  python tools/fill_workbook.py scores.json 1학년_춤_1_1.xlsm 결과.xlsm
 - .xlsm 은 파일 안의 XML 만 고쳐서 매크로·`확인` 단추가 그대로 남습니다. (pip 설치 필요 없음)
 - .xlsx 는 openpyxl 로 씁니다.            (pip install openpyxl)
"""
import sys, json, re, zipfile

ORDER = ["정확성", "리듬박자", "표현력", "팀워크", "동선", "활동성", "수행노력", "협업", "태도"]

def col_index(letters):
    n = 0
    for ch in letters: n = n * 26 + ord(ch) - 64
    return n

def split(cell):
    m = re.fullmatch(r'([A-Z]+)(\d+)', cell); return m.group(1), int(m.group(2))

def check(c):
    col, _ = split(c['cell'])
    k = (col_index(col) - 5) % 9
    if ORDER[k] != c['criterion']:
        raise SystemExit(f"위치 불일치: {c['sheet']} {c['cell']} 는 {ORDER[k]} 열인데 {c['criterion']} 점수입니다.")

def patch_sheet(xml, cells):
    """cells: {'W5': 20, ...} -> 시트 XML 에 숫자 입력 (서식 s 속성은 그대로 유지)"""
    for ref, val in cells.items():
        col, row = split(ref)
        m = re.search(r'<row r="%d"[^>]*?(/>|>.*?</row>)' % row, xml, flags=re.S)
        if not m: raise SystemExit(f'{ref}: 행을 찾지 못했습니다.')
        rowxml = m.group(0)
        cm = re.search(r'<c r="%s"([^>]*?)(/>|>.*?</c>)' % ref, rowxml, flags=re.S)
        if cm:
            s = re.search(r' s="\d+"', cm.group(1))
            newc = f'<c r="{ref}"{s.group(0) if s else ""}><v>{val}</v></c>'
            newrow = rowxml[:cm.start()] + newc + rowxml[cm.end():]
        else:
            newc = f'<c r="{ref}"><v>{val}</v></c>'
            if rowxml.endswith('/>'):
                newrow = rowxml[:-2] + '>' + newc + '</row>'
            else:
                pos = None
                for c2 in re.finditer(r'<c r="([A-Z]+)\d+"', rowxml):
                    if col_index(c2.group(1)) > col_index(col): pos = c2.start(); break
                pos = pos if pos is not None else rowxml.rfind('</row>')
                newrow = rowxml[:pos] + newc + rowxml[pos:]
        xml = xml[:m.start()] + newrow + xml[m.end():]
    return xml

def fill_xlsm(data, src, dst):
    zin = zipfile.ZipFile(src)
    wbxml = zin.read('xl/workbook.xml').decode('utf-8')
    rels = zin.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    rid = {n: r for n, r in re.findall(r'<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"', wbxml)}
    target = {}
    for m in re.finditer(r'<Relationship [^>]*>', rels):
        t = m.group(0)
        i = re.search(r'Id="([^"]+)"', t).group(1); tg = re.search(r'Target="([^"]+)"', t).group(1)
        target[i] = 'xl/' + tg.lstrip('/').replace('xl/', '')
    per = {}
    for c in data['cells']:
        check(c); per.setdefault(c['sheet'], {})[c['cell']] = c['value']
    files = {}
    for name, cells in per.items():
        if name not in rid: raise SystemExit(f'{name} 시트가 없습니다.')
        files[target[rid[name]]] = cells
    zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        b = zin.read(item.filename)
        if item.filename in files:
            b = patch_sheet(b.decode('utf-8'), files[item.filename]).encode('utf-8')
        elif item.filename == 'xl/workbook.xml':
            s = b.decode('utf-8')
            if 'fullCalcOnLoad' not in s:
                s = re.sub(r'<calcPr ([^>]*?)/>', r'<calcPr \1 fullCalcOnLoad="1"/>', s)
            b = s.encode('utf-8')
        zout.writestr(item, b)
    zout.close()
    return sum(len(v) for v in per.values())

def fill_xlsx(data, src, dst):
    import openpyxl, warnings
    warnings.filterwarnings('ignore')
    wb = openpyxl.load_workbook(src)
    n = 0
    for c in data['cells']:
        check(c); wb[c['sheet']][c['cell']] = c['value']; n += 1
    wb.save(dst); return n

if __name__ == '__main__':
    if len(sys.argv) != 4: raise SystemExit(__doc__)
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    src, dst = sys.argv[2], sys.argv[3]
    n = fill_xlsm(data, src, dst) if src.lower().endswith('.xlsm') else fill_xlsx(data, src, dst)
    print(f'{n}칸 입력 완료 -> {dst}')
