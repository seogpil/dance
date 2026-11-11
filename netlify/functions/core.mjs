// 평가 규칙·위치 계산 (화면/저장소와 무관한 순수 로직). 명단 R 은 항상 인자로 받는다.
import { createHmac, randomInt } from "node:crypto";

// 평가표 B열 요소와 점수 입력 셀(행). 열은 조원 순서대로 E~K.
export const CRITERIA = [
  { key: "정확성",   row: 4,  allowed: [20, 17, 14, 11, 6, 0] },
  { key: "리듬박자", row: 10, allowed: [20, 17, 14, 11, 6, 0] },
  { key: "표현력",   row: 16, allowed: [20, 17, 14, 11, 6, 0] },
  { key: "팀워크",   row: 22, allowed: [20, 17, 14, 11, 6, 0] },
  { key: "동선",     row: 28, allowed: [20, 17, 14, 11, 6, 0] },
  { key: "활동성",   row: 37, allowed: [20, 14, 4, 0] },
  { key: "수행노력", row: 41, allowed: [30, 24, 18, 0] },
  { key: "협업",     row: 45, allowed: [30, 24, 18, 2] },
  { key: "태도",     row: 49, range: [0, 40] },          // 20점 기준, 지적 -2 / 도움 +2
];
export const SLOT_LETTERS = ["E", "F", "G", "H", "I", "J", "K"];
export const MAX_GROUP = 4;           // 반 시트에 조 칸이 1~4조까지 있음
export const ALLOW_OWN_GROUP = false; // true 로 바꾸면 자기 조도 평가할 수 있음

const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, "");

export function classStudents(R, cls) {
  return R.filter((s) => s.cls === Number(cls)).sort((a, b) => a.no - b.no);
}

// J1(번호)·K1(이름)·F1(반) 확인: 1학년명렬의 반·번호·이름과 모두 같아야 참
export function findStudent(R, cls, no, name) {
  const c = Number(cls), n = Number(no);
  if (!Number.isInteger(c) || !Number.isInteger(n)) return null;
  return R.find((s) => s.cls === c && s.no === n && norm(s.name) === norm(name)) || null;
}

export function leaders(R, cls) {
  return R.filter((s) => s.cls === Number(cls) && s.leader)
    .sort((a, b) => a.group - b.group)
    .map((s) => ({ group: s.group, leader: s.name }));
}

// 평가표 E3~K3와 같은 순서: 조장 먼저, 이어서 같은 조 조원(명렬 행 순서)
export function groupMembers(R, cls, group) {
  const g = Number(group);
  const all = R.filter((s) => s.cls === Number(cls) && s.group === g);
  const lead = all.filter((s) => s.leader);
  const rest = all.filter((s) => !s.leader);
  return [...lead, ...rest].slice(0, SLOT_LETTERS.length)
    .map((s, i) => ({ slot: SLOT_LETTERS[i], no: s.no, name: s.name, leader: s.leader }));
}

export function colLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// 1~9반 시트 안의 정확한 위치: 행 = 조 시작행(1조 5, 2조 15…) + 조원 순서, 열 = 심판 칸(E부터 9칸씩) + 요소 순서
export function cellFor(R, cls, evaluatorNo, group, slotIndex, criterionIndex) {
  const idx = classStudents(R, cls).findIndex((s) => s.no === Number(evaluatorNo));
  if (idx < 0) return null;
  const row = 5 + 10 * (Number(group) - 1) + slotIndex;
  const col = 5 + 9 * idx + criterionIndex;
  return { sheet: `${cls}반`, cell: `${colLetter(col)}${row}`, row, col };
}

export function validValue(crit, v) {
  if (v === "" || v === null || v === undefined) return true;   // 비워 두면 미입력
  const x = Number(v);
  if (!Number.isFinite(x)) return false;
  if (crit.allowed) return crit.allowed.includes(x);
  return Number.isInteger(x) && x >= crit.range[0] && x <= crit.range[1];
}

export function cleanScores(R, cls, group, scores) {
  const members = groupMembers(R, cls, group);
  const out = {};
  for (const m of members) {
    const row = (scores && scores[m.slot]) || {};
    out[m.slot] = {};
    for (const c of CRITERIA) {
      const v = row[c.key];
      if (v === "" || v === null || v === undefined) continue;
      if (!validValue(c, v)) return { error: `${m.name}의 ${c.key} 점수(${v})가 올바르지 않습니다. 평가표의 점수만 입력하세요.` };
      out[m.slot][c.key] = Number(v);
    }
  }
  return { scores: out };
}

// ---- 점수는 "평가자 번호 → 받은 학생 번호 → 요소 → 점수" 로 저장한다 (조가 바뀌어도 학생을 따라감) ----
const hasVals = (v) => v && Object.keys(v).length > 0;

// 화면의 칸(E~K) 기준 점수 -> 받은 학생 번호 기준
export function slotsToNumbers(R, cls, group, slotScores) {
  const out = {};
  for (const m of groupMembers(R, cls, group)) out[m.no] = slotScores?.[m.slot] || {};
  return out;
}

// 저장된 기록(예전 방식 + 새 방식)을 평가자별 하나로 합친다.
//  예전 기록: key 가 반-번호-조, scores 가 칸(E~K) 기준 -> 현재 명단으로 번호로 바꿔 준다.
//  새 기록 : v === 2, key 가 반-번호, scores 가 학생 번호 기준
export function normalizeRecords(R, recs) {
  const sorted = [...recs].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
  const out = new Map();
  for (const r of sorted) {
    const id = `${r.cls}-${r.no}`;
    const cur = out.get(id) || { v: 2, cls: r.cls, no: r.no, name: r.name, scores: {}, savedAt: r.savedAt };
    if (r.v === 2) {
      for (const [t, vals] of Object.entries(r.scores || {})) { if (hasVals(vals)) cur.scores[t] = vals; else delete cur.scores[t]; }
    } else {
      for (const m of groupMembers(R, r.cls, r.group)) { const vals = r.scores?.[m.slot]; if (hasVals(vals)) cur.scores[m.no] = vals; }
    }
    cur.name = r.name; cur.savedAt = r.savedAt; out.set(id, cur);
  }
  return out;
}

// 평가자 한 명의 기록 -> 1~9반 시트 칸 목록. 받은 학생의 "지금" 조와 순서로 위치를 계산한다.
export function recordCells(R, rec) {
  const cells = [], skipped = [];
  for (const [t, vals] of Object.entries(rec.scores || {})) {
    const s = R.find((x) => x.cls === rec.cls && x.no === Number(t));
    const members = s && s.group ? groupMembers(R, rec.cls, s.group) : [];
    const si = s ? members.findIndex((m) => m.no === s.no) : -1;
    if (si < 0) { skipped.push({ evaluator: `${rec.cls}반 ${rec.no}번 ${rec.name}`, target: `${rec.cls}반 ${t}번`, reason: s ? "조가 없음" : "명단에 없음" }); continue; }
    CRITERIA.forEach((c, ci) => {
      const v = vals[c.key];
      if (v === undefined) return;
      const pos = cellFor(R, rec.cls, rec.no, s.group, si, ci);
      if (!pos) { return; }
      cells.push({ sheet: pos.sheet, cell: pos.cell, value: v, criterion: c.key,
                   evaluator: `${rec.no} ${rec.name}`, target: `${members[si].slot}3 ${s.name}`, group: s.group });
    });
  }
  return { cells, skipped };
}

// ---- 개인 입장 코드: 명단에 저장된 학생별 code 를 쓰고, 없으면 secret 으로 계산 ----
const CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";   // 헷갈리는 0,o,1,l,i 제외
export function codeFor(secret, cls, no) {
  const h = createHmac("sha256", `${secret}:personal-code`).update(`${cls}-${no}`).digest();
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_CHARS[h[i] % CODE_CHARS.length];
  return out;
}
export const randomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
export const normCode = (s) => String(s ?? "").trim().toLowerCase();
export function studentCode(s, secret) {
  if (s.code) return s.code;
  return secret ? codeFor(secret, s.cls, s.no) : null;
}
export function allCodes(R, secret) {
  return R.map((s) => ({ cls: s.cls, no: s.no, name: s.name, code: studentCode(s, secret) }));
}

// ---- 명단 올리기 ----
// incoming: [{cls,no,name,group,leader}] -> 검사 후 기존 코드는 유지하고 새 학생에게만 코드를 만든다.
export function buildRoster(incoming, existing, secret) {
  const errors = [], warnings = [];
  if (!Array.isArray(incoming) || incoming.length === 0) return { errors: ["명단이 비어 있습니다."], warnings };
  const seen = new Set(), list = [];
  const oldCode = new Map(existing.map((s) => [`${s.cls}-${s.no}`, studentCode(s, secret)]));   // 지금 쓰이는 코드(계산 코드 포함)를 그대로 고정
  for (const [i, s] of incoming.entries()) {
    const cls = Number(s.cls), no = Number(s.no), name = String(s.name ?? "").trim();
    const where = `${s.row ?? i + 2}행`;
    if (!Number.isInteger(cls) || cls < 1 || cls > 9) { errors.push(`${where}: 학급은 1~9여야 합니다.`); continue; }
    if (!Number.isInteger(no) || no < 1 || no > 99) { errors.push(`${where}: 번호가 올바르지 않습니다.`); continue; }
    if (!name) { errors.push(`${where}: 이름이 비어 있습니다.`); continue; }
    const key = `${cls}-${no}`;
    if (seen.has(key)) { errors.push(`${cls}반 ${no}번이 두 번 있습니다.`); continue; }
    seen.add(key);
    let group = s.group === null || s.group === undefined || s.group === "" ? null : Number(s.group);
    if (group !== null && (!Number.isInteger(group) || group < 1 || group > MAX_GROUP)) {
      errors.push(`${cls}반 ${no}번 ${name}: 조는 1~${MAX_GROUP}조여야 합니다.`); continue;
    }
    list.push({ cls, no, name, group, leader: !!(group && s.leader) });
  }
  for (let c = 1; c <= 9; c++) {
    for (let g = 1; g <= MAX_GROUP; g++) {
      const m = list.filter((s) => s.cls === c && s.group === g);
      if (!m.length) continue;
      const lead = m.filter((s) => s.leader).length;
      if (m.length > SLOT_LETTERS.length) errors.push(`${c}반 ${g}조가 ${m.length}명입니다. 한 조는 조장 포함 ${SLOT_LETTERS.length}명까지입니다.`);
      if (lead > 1) errors.push(`${c}반 ${g}조에 조장이 ${lead}명입니다.`);
      if (lead === 0) warnings.push(`${c}반 ${g}조에 조장이 없어서 선택 목록에 나오지 않습니다.`);
    }
  }
  if (errors.length) return { errors, warnings };
  const students = list.map((s) => ({ ...s, code: oldCode.get(`${s.cls}-${s.no}`) || randomCode() }));
  return { errors, warnings, students };
}

export function diffRoster(oldR, newR) {
  const o = new Map(oldR.map((s) => [`${s.cls}-${s.no}`, s]));
  const n = new Map(newR.map((s) => [`${s.cls}-${s.no}`, s]));
  const d = { added: 0, removed: 0, regrouped: 0, leaderChanged: 0, renamed: 0, newCodes: 0 };
  for (const [k, s] of n) {
    const p = o.get(k);
    if (!p) { d.added++; d.newCodes++; continue; }
    if (p.group !== s.group) d.regrouped++;
    if (!!p.leader !== !!s.leader) d.leaderChanged++;
    if (p.name !== s.name) d.renamed++;
  }
  for (const k of o.keys()) if (!n.has(k)) d.removed++;
  // 조원 구성이 달라진 조: 이미 저장된 점수가 어긋날 수 있다
  const affected = new Set();
  for (let c = 1; c <= 9; c++) for (let g = 1; g <= MAX_GROUP; g++) {
    const a = groupMembers(oldR, c, g).map((m) => m.no).join(","), b = groupMembers(newR, c, g).map((m) => m.no).join(",");
    if (a !== b) affected.add(`${c}-${g}`);
  }
  return { ...d, affected };
}
