import { handle } from "../netlify/functions/handler.mjs";
import { cellFor, groupMembers } from "../netlify/functions/core.mjs";
import roster from "../netlify/functions/roster.mjs";
import assert from "node:assert";

const mkStore = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, delete: async (k) => { m.delete(k); }, list: async () => [...m.keys()] }; };
let store = mkStore(), config = mkStore();
let env = { ADMIN_KEY: "secret" };
const call = async (path, body, method = "POST") => {
  const r = await handle(new Request("https://x.test" + path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }), { store, config, env });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, ...(ct.includes("json") ? await r.json() : { text: await r.text() }) };
};
const exp = async () => call("/api/export?key=secret", null, "GET");
const find = (cells, name, crit) => cells.find((c) => c.target.endsWith(` ${name}`) && c.criterion === crit);

// ---------- 1) 기본 동작 ----------
let r = await call("/api/login", { cls: 1, no: 5, name: "엉터리" }); assert.equal(r.status, 401);
const g1 = groupMembers(roster, 1, 1);                                   // 1반 1조: 조장 + 조원
const ev = roster.filter(s => s.cls === 1 && s.group === 2 && !s.leader)[0];
r = await call("/api/login", { cls: 1, no: ev.no, name: ev.name }); assert.ok(r.ok && !r.leaders.some(l => l.group === 2));
assert.equal((await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 2 })).status, 400);   // 자기 조
assert.ok((await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, scores: { E: { 정확성: 20, 리듬박자: 17, 태도: 20 }, F: { 정확성: 14, 협업: 24 } } })).ok);
assert.equal((await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, scores: { E: { 정확성: 19 } } })).status, 400);
assert.deepEqual((await call("/api/form", { cls: 1, no: roster.find(s => s.cls === 1 && s.group === 3).no, name: roster.find(s => s.cls === 1 && s.group === 3).name, group: 1 })).scores.E, {});   // 남의 점수는 안 보임
assert.equal((await call("/api/export?key=nope", null, "GET")).status, 403);
let e1 = await exp(); assert.equal(e1.count, 1); assert.equal(e1.cells.length, 5);
const idx = (cell) => cell; // 위치는 아래에서 비교
console.log("기본:", e1.cells.map(c => c.sheet + c.cell + "=" + c.value).join(" "));
// 저장은 학생 번호로
const rec = store.m.get(`1-${ev.no}`); assert.equal(rec.v, 2); assert.deepEqual(Object.keys(rec.scores).sort(), [String(g1[0].no), String(g1[1].no)].sort());
console.log("저장 방식: 번호 기준", JSON.stringify(rec.scores));

// ---------- 2) 개인 입장 코드 ----------
env = { ADMIN_KEY: "secret", PERSONAL_CODES: "true" };
const code1 = roster.find(s => s.cls === 1 && s.no === 1).code, code2 = roster.find(s => s.cls === 1 && s.no === 2).code;
assert.equal((await call("/api/login", { cls: 1, no: 1, name: "강다인" })).status, 403);
assert.equal((await call("/api/login", { cls: 1, no: 1, name: "강다인", code: code2 })).status, 403);
assert.ok((await call("/api/login", { cls: 1, no: 1, name: "강다인", code: code1.toUpperCase() })).ok);
console.log("개인 코드 통과");

// ---------- 3) 조를 바꿔도 점수가 학생을 따라감 ----------
const sheet = roster.map(({ cls, no, name, group, leader }) => ({ cls, no, name, group, leader }));
const mod = sheet.map(s => ({ ...s }));
const mover = mod.find(s => s.cls === 1 && s.group === 1 && !s.leader && s.no === g1[1].no);   // 점수를 받은 조원 (F칸)
const size = (g) => mod.filter(s => s.cls === 1 && s.group === g).length;
const toG = [2, 3, 4].find(g => size(g) < 7); mover.group = toG;
r = await call("/api/roster", { key: "secret", students: mod, commit: true }); assert.ok(r.committed); console.log("조 이동 미리보기 요약:", JSON.stringify({ regrouped: r.regrouped, orphanScores: r.orphanScores }));
assert.equal(r.orphanScores, 0);                                          // 점수가 갈 곳을 잃지 않음
const R2 = mod.map((s) => ({ ...s }));
let e2 = await exp();
const leadCell = find(e2.cells, g1[0].name, "정확성");
assert.equal(leadCell.value, 20); assert.equal(leadCell.cell, cellFor(R2, 1, ev.no, 1, 0, 0).cell);          // 조장 점수는 그대로 1조 첫 칸
const moved = find(e2.cells, mover.name, "정확성"); assert.equal(moved.value, 14);
const newPos = cellFor(R2, 1, ev.no, toG, groupMembers(R2, 1, toG).findIndex(m => m.no === mover.no), 0);
assert.equal(moved.cell, newPos.cell); assert.equal(moved.group, toG);                                    // 새 조의 맞는 칸으로 이동
assert.equal(find(e2.cells, mover.name, "협업").value, 24);
console.log(`조 이동 후: ${mover.name} 점수는 ${toG}조 ${moved.cell} 로 따라감 (정확성 14, 협업 24)`);
// 다시 저장해도 이동한 학생의 점수는 지워지지 않음
const f = await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 1, code: roster.find(s => s.cls === 1 && s.no === ev.no).code });
assert.ok(f.ok); assert.ok(!f.members.some(m => m.name === mover.name));
assert.ok((await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, code: roster.find(s => s.cls === 1 && s.no === ev.no).code, scores: { E: { 정확성: 17 } } })).ok);
let e3 = await exp(); assert.equal(find(e3.cells, mover.name, "정확성").value, 14); assert.equal(find(e3.cells, g1[0].name, "정확성").value, 17);
// 명단에서 빠진 학생의 점수는 건너뜀(orphan)
const mod2 = mod.filter((s) => !(s.cls === 1 && s.no === mover.no));
r = await call("/api/roster", { key: "secret", students: mod2 }); assert.equal(r.orphanScores, 1);
await call("/api/roster", { key: "secret", students: mod2, commit: true });
const e4 = await exp(); assert.ok(!find(e4.cells, mover.name, "정확성")); assert.equal(e4.skipped.length, 1); console.log("명단에서 빠진 학생:", JSON.stringify(e4.skipped[0]));
console.log("조 변경 점수 이동 통과");

// ---------- 4) 예전 방식 기록 변환 ----------
store = mkStore(); config = mkStore(); env = { ADMIN_KEY: "secret" };
const L = (g, scores, t) => ({ cls: 1, no: ev.no, name: ev.name, group: g, scores, savedAt: t });
store.m.set(`1-${ev.no}-1`, L(1, { E: { 정확성: 20 }, F: { 정확성: 14 } }, "2026-11-01T01:00:00.000Z"));
store.m.set(`1-${ev.no}-3`, L(3, { E: { 표현력: 11 } }, "2026-11-01T02:00:00.000Z"));
let beforeCells = (await exp()).cells.map(c => c.sheet + c.cell + "=" + c.value).sort();
assert.deepEqual(beforeCells.length, 3); console.log("예전 기록 변환 전 보기:", beforeCells.join(" "));
r = await call("/api/migrate?key=secret", null, "GET"); assert.ok(r.ok); assert.equal(r.converted, 1); assert.equal(r.legacyRecords, 2);
assert.deepEqual([...store.m.keys()], [`1-${ev.no}`]);
assert.deepEqual((await exp()).cells.map(c => c.sheet + c.cell + "=" + c.value).sort(), beforeCells);
r = await call("/api/migrate?key=secret", null, "GET"); assert.equal(r.converted, 0);
console.log("예전 기록 변환 통과");

// ---------- 5) 명단 올리기 ----------
const mod3 = sheet.map(s => ({ ...s })); mod3.push({ cls: 1, no: 40, name: "새학생", group: 1, leader: false });
assert.equal((await call("/api/roster", { key: "bad", students: mod3 })).status, 403);
r = await call("/api/roster", { key: "secret", students: mod3 }); assert.ok(r.ok && !r.committed && r.added === 1);
const over = sheet.map(s => ({ ...s })); over.find(s => s.cls === 1 && s.group === 1 && !s.leader).group = 3;
assert.equal((await call("/api/roster", { key: "secret", students: over })).status, 422);
const dup = sheet.map(s => ({ ...s })); dup.push({ ...dup[0] }); assert.equal((await call("/api/roster", { key: "secret", students: dup })).status, 422);
assert.equal((await call("/api/roster", { key: "secret", students: [] })).status, 422);
await call("/api/roster", { key: "secret", students: mod3, commit: true });
const ex = await call("/api/roster/export?key=secret", null, "GET"); assert.equal(ex.count, 227); assert.ok(!("code" in ex.students[0]));
const codes = (await call("/api/codes?key=secret&format=json", null, "GET")).codes;
assert.equal(codes.find(c => c.cls === 1 && c.no === 1).code, code1); assert.equal(codes.find(c => c.name === "새학생").code.length, 6);
console.log("명단 올리기·내려받기 통과");

// ---------- 6) 예전 명단 + ADMIN_KEY 계산 코드는 올려도 유지 ----------
{
  const { codeFor, buildRoster, allCodes } = await import("../netlify/functions/core.mjs");
  const bundledNoCode = roster.map(({ code, ...s }) => s);
  const before = allCodes(bundledNoCode, "secret").map(c => c.code);
  assert.equal(before[0], codeFor("secret", roster[0].cls, roster[0].no));
  assert.deepEqual(buildRoster(sheet, bundledNoCode, "secret").students.map(s => s.code), before);
  console.log("예전 명단 코드 유지 통과");
}
console.log("모든 시험 통과");
