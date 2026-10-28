import {
  CRITERIA, ALLOW_OWN_GROUP, findStudent, leaders, groupMembers, cleanScores, toCells, codeFor, normCode, allCodes,
} from "./core.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ ok: false, message: msg }, status);

const WRONG = "반·번호·이름이 1학년명렬과 맞지 않습니다. 다시 작성하세요.";

// store: { get(key), setJSON(key,val), list() -> keys[] }
export async function handle(req, { store, env = {} }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/export") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return bad("관리자 키가 맞지 않습니다.", 403);
    const keys = await store.list();
    const recs = [];
    for (const k of keys) { const r = await store.get(k); if (r) recs.push(r); }
    const cells = recs.flatMap(toCells);
    return json({ ok: true, count: recs.length, records: recs, cells });
  }

  if (path === "/api/codes") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return bad("관리자 키가 맞지 않습니다.", 403);
    const rows = allCodes(env.ADMIN_KEY);
    if (url.searchParams.get("format") === "json") return json({ ok: true, codes: rows });
    const csv = "\uFEFF반,번호,이름,입장코드\r\n" + rows.map((r) => `${r.cls},${r.no},${r.name},${r.code}`).join("\r\n") + "\r\n";
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="entry-codes.csv"', "cache-control": "no-store" } });
  }

  if (req.method !== "POST") return bad("POST 요청만 가능합니다.", 405);
  let body;
  try { body = await req.json(); } catch { return bad("요청 형식이 올바르지 않습니다."); }

  const me = findStudent(body.cls, body.no, body.name);
  if (!me) return bad(WRONG, 401);                      // 거짓 → 다시 작성

  if (env.PERSONAL_CODES && String(env.PERSONAL_CODES).toLowerCase() !== "false") {
    // 학생마다 다른 입장 코드 (ADMIN_KEY 로 계산)
    if (!env.ADMIN_KEY) return bad("서버 설정(ADMIN_KEY)이 없습니다.", 500);
    if (normCode(body.code) !== codeFor(env.ADMIN_KEY, me.cls, me.no)) return bad("내 입장 코드가 맞지 않습니다. 선생님께 받은 코드를 입력하세요.", 403);
  } else if (env.ACCESS_CODE && String(body.code ?? "") !== env.ACCESS_CODE) {
    return bad("입장 코드가 맞지 않습니다.", 403);
  }

  if (path === "/api/login") {
    const mine = leaders(me.cls).filter((l) => ALLOW_OWN_GROUP || l.group !== me.group);
    return json({ ok: true, student: { cls: me.cls, no: me.no, name: me.name }, leaders: mine });
  }

  const group = Number(body.group);
  if (!Number.isInteger(group) || !leaders(me.cls).some((l) => l.group === group)) return bad("조장을 다시 선택하세요.");
  if (!ALLOW_OWN_GROUP && me.group === group) return bad("자기 조는 평가할 수 없습니다. 다른 조장을 선택하세요.");
  const key = `${me.cls}-${me.no}-${group}`;

  if (path === "/api/form") {
    const saved = await store.get(key);               // 본인이 저장한 것만 돌려줌
    return json({
      ok: true, criteria: CRITERIA.map(({ key: k, row, allowed, range }) => ({ key: k, row, allowed, range })),
      members: groupMembers(me.cls, group).map(({ slot, name, leader }) => ({ slot, name, leader })),
      scores: saved?.scores || {}, savedAt: saved?.savedAt || null,
    });
  }

  if (path === "/api/submit") {
    const r = cleanScores(me.cls, group, body.scores);
    if (r.error) return bad(r.error);
    const rec = { cls: me.cls, no: me.no, name: me.name, group, scores: r.scores, savedAt: new Date().toISOString() };
    await store.setJSON(key, rec);
    return json({ ok: true, savedAt: rec.savedAt });
  }

  return bad("알 수 없는 요청입니다.", 404);
}
