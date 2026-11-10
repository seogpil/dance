import { handle } from "../netlify/functions/handler.mjs";
import { cellFor, groupMembers, classStudents } from "../netlify/functions/core.mjs";
import roster from "../netlify/functions/roster.mjs";
import assert from "node:assert";

const mkStore = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, list: async () => [...m.keys()] }; };
const store = mkStore(), config = mkStore();
let env = { ADMIN_KEY: "secret" };
const call = async (path, body, method = "POST") => {
  const r = await handle(new Request("https://x.test" + path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }), { store, config, env });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, ...(ct.includes("json") ? await r.json() : { text: await r.text() }) };
};

// 1) 참/거짓
let r = await call("/api/login", { cls: 1, no: 5, name: "엉터리" }); assert.equal(r.status, 401);
// 2) 평가자: 1반 2조 조원이 1조 평가
const ev = roster.filter(s => s.cls === 1 && s.group === 2 && !s.leader)[0];
r = await call("/api/login", { cls: 1, no: ev.no, name: ev.name }); assert.ok(r.ok); assert.ok(!r.leaders.some(l => l.group === 2));
r = await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 2 }); assert.equal(r.status, 400);       // 자기 조
r = await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 1 }); assert.ok(r.ok);
const scores = { E: { 정확성: 20, 리듬박자: 17, 태도: 20 }, F: { 정확성: 14, 협업: 24 } };
assert.ok((await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, scores })).ok);
assert.equal((await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, scores: { E: { 정확성: 19 } } })).status, 400);
// 3) 다른 사람은 내 입력을 못 봄
const other = roster.find(s => s.cls === 1 && s.group === 3);
r = await call("/api/form", { cls: 1, no: other.no, name: other.name, group: 1 }); assert.deepEqual(r.scores, {});
// 4) 관리자 취합
assert.equal((await call("/api/export?key=nope", null, "GET")).status, 403);
r = await call("/api/export?key=secret", null, "GET"); assert.equal(r.count, 1); assert.equal(r.cells.length, 5);
console.log("기본 동작 통과:", r.cells.map(c => c.sheet + c.cell + "=" + c.value).join(" "));

// 5) 개인 입장 코드 (명단에 저장된 코드)
env = { ADMIN_KEY: "secret", PERSONAL_CODES: "true" };
const csv = await call("/api/codes?key=secret", null, "GET"); const lines = csv.text.trim().split("\r\n"); assert.equal(lines.length, 227);
const code1 = lines.find(l => l.startsWith("1,1,")).split(",")[3], code2 = lines.find(l => l.startsWith("1,2,")).split(",")[3];
assert.equal(code1, roster.find(s => s.cls === 1 && s.no === 1).code);
assert.equal((await call("/api/login", { cls: 1, no: 1, name: "강다인" })).status, 403);
assert.equal((await call("/api/login", { cls: 1, no: 1, name: "강다인", code: code2 })).status, 403);
assert.ok((await call("/api/login", { cls: 1, no: 1, name: "강다인", code: code1.toUpperCase() })).ok);
console.log("개인 코드 통과");

// 6) 명단 올리기
const sheet = roster.map(({ cls, no, name, group, leader }) => ({ cls, no, name, group, leader }));
assert.equal((await call("/api/roster", { key: "bad", students: sheet })).status, 403);
r = await call("/api/roster", { key: "secret", students: sheet }); assert.ok(r.ok && !r.committed); assert.equal(r.added + r.removed + r.regrouped, 0); console.log("변경 없음 미리보기:", JSON.stringify(r));
// 변경: 1반 1조 조원 한 명을 2조로, 새 학생 추가, 학생 한 명 삭제
const mod = sheet.map(s => ({ ...s }));
const mover = mod.find(s => s.cls === 1 && s.group === 1 && !s.leader);
const size = (g) => mod.filter(s => s.cls === 1 && s.group === g).length;
const toG = [2, 3, 4].find(g => size(g) < 7); mover.group = toG;
mod.push({ cls: 1, no: 40, name: "새학생", group: 1, leader: false });
const gone = mod.findIndex(s => s.cls === 9 && !s.leader); const goneName = mod.splice(gone, 1)[0];
r = await call("/api/roster", { key: "secret", students: mod });
assert.ok(r.ok && !r.committed); assert.equal(r.added, 1); assert.equal(r.removed, 1); assert.equal(r.regrouped, 1); assert.ok(r.affectedScores >= 1);
console.log("변경 미리보기:", JSON.stringify(r));
assert.equal(config.m.size, 0);                                   // 미리보기는 저장하지 않음
r = await call("/api/roster", { key: "secret", students: mod, commit: true }); assert.ok(r.committed); assert.equal(config.m.size, 1);
// 새 명단이 바로 적용되는지
const newCode = (await call("/api/codes?key=secret&format=json", null, "GET")).codes;
const ns = newCode.find(c => c.name === "새학생"); assert.ok(ns && ns.code.length === 6);
assert.equal(newCode.find(c => c.cls === 1 && c.no === 1).code, code1);                 // 기존 학생 코드 유지
assert.ok((await call("/api/login", { cls: 1, no: 40, name: "새학생", code: ns.code })).ok);
assert.equal((await call("/api/login", { cls: goneName.cls, no: goneName.no, name: goneName.name, code: "xxxxxx" })).status, 401);   // 삭제된 학생
r = await call("/api/form", { cls: 1, no: other.no, name: other.name, code: roster.find(s => s.cls === 1 && s.no === other.no).code, group: toG });
assert.ok(r.members.some(m => m.name === mover.name)); console.log(`명단 반영 확인: ${toG}조 조원에`, mover.name, "포함");
// 인원 초과(8명) 거부
const over = sheet.map(s => ({ ...s })); over.find(s => s.cls === 1 && s.group === 1 && !s.leader).group = 3;
r = await call("/api/roster", { key: "secret", students: over }); assert.equal(r.status, 422); console.log("인원 초과:", r.errors[0]);
// 잘못된 명단 거부
const badList = mod.map(s => ({ ...s })); badList.find(s => s.cls === 2 && s.group === 1 && !s.leader).leader = true;
r = await call("/api/roster", { key: "secret", students: badList }); assert.equal(r.status, 422); console.log("잘못된 명단:", r.errors[0]);
r = await call("/api/roster", { key: "secret", students: [] }); assert.equal(r.status, 422);
const dup = mod.map(s => ({ ...s })); dup.push({ ...dup[0] });
r = await call("/api/roster", { key: "secret", students: dup }); assert.equal(r.status, 422);
console.log("모든 시험 통과");
