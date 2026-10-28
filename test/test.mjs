import { handle } from "../netlify/functions/handler.mjs";
import { cellFor, groupMembers } from "../netlify/functions/core.mjs";
import assert from "node:assert";
const mem = new Map();
const store = { get: async (k) => mem.get(k) ?? null, setJSON: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); }, list: async () => [...mem.keys()] };
const env = { ADMIN_KEY: "secret" };
const call = async (path, body, method = "POST") => {
  const r = await handle(new Request("https://x.test" + path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }), { store, env });
  return { status: r.status, ...(await r.json()) };
};
// 1) 참/거짓
let r = await call("/api/login", { cls: 1, no: 5, name: "엉터리" }); assert.equal(r.status, 401); console.log("거짓:", r.message);
r = await call("/api/login", { cls: 1, no: 5, name: "박찬서" }); console.log("login:", r.status, JSON.stringify(r).slice(0, 200));
// 2) 평가자 확인: 1반 번호/이름은 명렬에서
import roster from "../netlify/functions/roster.mjs";
const ev = roster.filter(s => s.cls === 1 && s.group === 2 && !s.leader)[0];   // 2조 조원이 1조를 평가
r = await call("/api/login", { cls: 1, no: ev.no, name: ev.name }); assert.ok(r.ok); console.log("leaders:", r.leaders);
assert.ok(!r.leaders.some(l => l.group === 2));
// 3) 자기 조 거부
r = await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 2 }); assert.equal(r.status, 400); console.log("own group:", r.message);
// 4) 1조 폼 + 저장
r = await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 1 }); assert.ok(r.ok); console.log("members:", r.members.map(m => m.slot + m.name).join(" "));
const scores = { E: { 정확성: 20, 리듬박자: 17, 태도: 20 }, F: { 정확성: 14, 협업: 24 } };
r = await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, scores }); assert.ok(r.ok);
r = await call("/api/submit", { cls: 1, no: ev.no, name: ev.name, group: 1, scores: { E: { 정확성: 19 } } }); assert.equal(r.status, 400); console.log("bad score:", r.message);
// 5) 다른 사람은 내 입력을 못 봄
const other = roster.filter(s => s.cls === 1 && s.group === 3)[0];
r = await call("/api/form", { cls: 1, no: other.no, name: other.name, group: 1 }); assert.deepEqual(r.scores, {}); console.log("다른 사람 화면의 저장값:", JSON.stringify(r.scores));
r = await call("/api/form", { cls: 1, no: ev.no, name: ev.name, group: 1 }); assert.equal(r.scores.E.정확성, 20);
// 6) 관리자 취합
r = await call("/api/export?key=nope", null, "GET"); assert.equal(r.status, 403);
r = await call("/api/export?key=secret", null, "GET"); assert.equal(r.count, 1); console.log(r.cells);
// 위치 확인: 1반 evaluator 인덱스
const idx = roster.filter(s => s.cls === 1).sort((a, b) => a.no - b.no).findIndex(s => s.no === ev.no);
console.log("evaluator", ev.no, ev.name, "block index", idx, cellFor(1, ev.no, 1, 0, 0), cellFor(9, 25, 4, 6, 8));

// ---- 개인 입장 코드 ----
{
  const envP = { ADMIN_KEY: "secret", PERSONAL_CODES: "true" };
  const callP = async (path, body, method = "POST") => {
    const r = await handle(new Request("https://x.test" + path, { method, body: method === "POST" ? JSON.stringify(body) : undefined }), { store, env: envP });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, ct, ...(ct.includes("json") ? await r.json() : { text: await r.text() }) };
  };
  const csv = await callP("/api/codes?key=secret", null, "GET");
  const lines = csv.text.trim().split("\r\n"); assert.equal(lines.length, 227);
  const code1 = lines.find(l => l.startsWith("1,1,")).split(",")[3];
  const code2 = lines.find(l => l.startsWith("1,2,")).split(",")[3];
  assert.notEqual(code1, code2); assert.equal(code1.length, 6);
  assert.equal((await callP("/api/codes?key=bad", null, "GET")).status, 403);
  let r = await callP("/api/login", { cls: 1, no: 1, name: "강다인" }); assert.equal(r.status, 403); console.log("코드 없음:", r.message);
  r = await callP("/api/login", { cls: 1, no: 1, name: "강다인", code: code2 }); assert.equal(r.status, 403);   // 남의 코드
  r = await callP("/api/login", { cls: 1, no: 1, name: "강다인", code: code1.toUpperCase() }); assert.ok(r.ok);  // 대문자도 허용
  r = await callP("/api/login", { cls: 1, no: 1, name: "엉터리", code: code1 }); assert.equal(r.status, 401);
  console.log("개인 코드 시험 통과, 예:", code1, code2);
}
