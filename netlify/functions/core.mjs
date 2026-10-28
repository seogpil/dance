// 평가 규칙·위치 계산 (화면/저장소와 무관한 순수 로직)
import { createHmac } from "node:crypto";
import roster from "./roster.mjs";

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
export const ALLOW_OWN_GROUP = false;   // true 로 바꾸면 자기 조도 평가할 수 있음

const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, "");

export function classStudents(cls) {
  return roster.filter((s) => s.cls === cls).sort((a, b) => a.no - b.no);
}

// J1(번호)·K1(이름)·F1(반) 확인: 1학년명렬의 반·번호·이름과 모두 같아야 참
export function findStudent(cls, no, name) {
  const c = Number(cls), n = Number(no);
  if (!Number.isInteger(c) || !Number.isInteger(n)) return null;
  return roster.find((s) => s.cls === c && s.no === n && norm(s.name) === norm(name)) || null;
}

export function leaders(cls) {
  return roster
    .filter((s) => s.cls === Number(cls) && s.leader)
    .sort((a, b) => a.group - b.group)
    .map((s) => ({ group: s.group, leader: s.name }));
}

// 평가표 E3~K3와 같은 순서: 조장 먼저, 이어서 같은 조 조원(명렬 행 순서)
export function groupMembers(cls, group) {
  const g = Number(group);
  const all = roster.filter((s) => s.cls === Number(cls) && s.group === g);
  const lead = all.filter((s) => s.leader);
  const rest = all.filter((s) => !s.leader);
  return [...lead, ...rest].slice(0, SLOT_LETTERS.length)
    .map((s, i) => ({ slot: SLOT_LETTERS[i], no: s.no, name: s.name, leader: s.leader }));
}

// 1~9반 시트 안의 정확한 위치
//  행: 조 시작행(1조 5, 2조 15, 3조 25, 4조 35) + 조원 순서
//  열: 심판(입력한 학생)의 칸(반 번호순 k번째 → E부터 9칸씩) + 요소 순서
export function colLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function cellFor(cls, evaluatorNo, group, slotIndex, criterionIndex) {
  const idx = classStudents(cls).findIndex((s) => s.no === Number(evaluatorNo));
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

// scores: { E: {정확성: 20, ...}, F: {...} } -> 정리된 값 또는 오류 메시지
export function cleanScores(cls, group, scores) {
  const members = groupMembers(cls, group);
  const out = {};
  for (const m of members) {
    const row = (scores && scores[m.slot]) || {};
    out[m.slot] = {};
    for (const c of CRITERIA) {
      const v = row[c.key];
      if (v === "" || v === null || v === undefined) continue;
      if (!validValue(c, v)) {
        return { error: `${m.name}의 ${c.key} 점수(${v})가 올바르지 않습니다. 평가표의 점수만 입력하세요.` };
      }
      out[m.slot][c.key] = Number(v);
    }
  }
  return { scores: out };
}

// 저장된 한 건 -> 시트/셀/값 목록
export function toCells(rec) {
  const members = groupMembers(rec.cls, rec.group);
  const cells = [];
  members.forEach((m, si) => {
    CRITERIA.forEach((c, ci) => {
      const v = rec.scores?.[m.slot]?.[c.key];
      if (v === undefined) return;
      const pos = cellFor(rec.cls, rec.no, rec.group, si, ci);
      if (!pos) return;
      cells.push({ sheet: pos.sheet, cell: pos.cell, value: v, criterion: c.key,
                   evaluator: `${rec.no} ${rec.name}`, target: `${m.slot}3 ${m.name}`, group: rec.group });
    });
  });
  return cells;
}

// ---- 개인 입장 코드: ADMIN_KEY 로 학생마다 다른 6글자 코드를 계산 (저장하지 않음) ----
const CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";   // 헷갈리는 0,o,1,l,i 제외
export function codeFor(secret, cls, no) {
  const h = createHmac("sha256", `${secret}:personal-code`).update(`${cls}-${no}`).digest();
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_CHARS[h[i] % CODE_CHARS.length];
  return out;
}
export const normCode = (s) => String(s ?? "").trim().toLowerCase();
export function allCodes(secret) {
  return roster.map((s) => ({ cls: s.cls, no: s.no, name: s.name, code: codeFor(secret, s.cls, s.no) }));
}
