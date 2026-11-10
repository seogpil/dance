import bundledRoster from "./roster.mjs";
import {
  CRITERIA, ALLOW_OWN_GROUP, findStudent, leaders, groupMembers, cleanScores, toCells,
  studentCode, normCode, allCodes, buildRoster, diffRoster,
} from "./core.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ ok: false, message: msg }, status);

const WRONG = "반·번호·이름이 1학년명렬과 맞지 않습니다. 다시 작성하세요.";

// 서버에 올려 둔 명단이 있으면 그것을, 없으면 배포 파일(roster.mjs)의 명단을 쓴다.
async function loadRoster(config) {
  const saved = config ? await config.get("roster") : null;
  return saved?.students?.length ? saved.students : bundledRoster;
}

// store: 점수 저장소 { get(key), setJSON(key,val), list() -> keys[] }, config: 설정 저장소 { get, setJSON }
export async function handle(req, { store, config, env = {} }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const adminOk = (key) => !!env.ADMIN_KEY && key === env.ADMIN_KEY;

  if (path === "/api/export") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!adminOk(key)) return bad("관리자 키가 맞지 않습니다.", 403);
    const R = await loadRoster(config);
    const keys = await store.list();
    const recs = [];
    for (const k of keys) { const r = await store.get(k); if (r) recs.push(r); }
    const cells = recs.flatMap((r) => toCells(R, r));
    return json({ ok: true, count: recs.length, records: recs, cells });
  }

  if (path === "/api/codes") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!adminOk(key)) return bad("관리자 키가 맞지 않습니다.", 403);
    const R = await loadRoster(config);
    const rows = allCodes(R, env.ADMIN_KEY);
    if (url.searchParams.get("format") === "json") return json({ ok: true, codes: rows });
    const csv = "\uFEFF반,번호,이름,입장코드\r\n" + rows.map((r) => `${r.cls},${r.no},${r.name},${r.code}`).join("\r\n") + "\r\n";
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="entry-codes.csv"', "cache-control": "no-store" } });
  }

  if (req.method !== "POST") return bad("POST 요청만 가능합니다.", 405);
  let body;
  try { body = await req.json(); } catch { return bad("요청 형식이 올바르지 않습니다."); }

  // ---- 명단 올리기 (관리자): commit 이 true 일 때만 저장, 아니면 미리보기 ----
  if (path === "/api/roster") {
    if (!adminOk(body.key ?? req.headers.get("x-admin-key"))) return bad("관리자 키가 맞지 않습니다.", 403);
    if (!config) return bad("서버에 명단 저장소가 없습니다.", 500);
    const current = await loadRoster(config);
    const built = buildRoster(body.students, current);
    if (built.errors.length) return json({ ok: false, message: "명단에 고칠 곳이 있습니다.", errors: built.errors.slice(0, 15), warnings: built.warnings }, 422);
    const d = diffRoster(current, built.students);
    let affectedScores = 0;
    if (d.affected.size) {
      for (const k of await store.list()) {
        const r = await store.get(k);
        if (r && d.affected.has(`${r.cls}-${r.group}`)) affectedScores++;
      }
    }
    const summary = { total: built.students.length, added: d.added, removed: d.removed, regrouped: d.regrouped,
      leaderChanged: d.leaderChanged, renamed: d.renamed, newCodes: d.newCodes,
      affectedGroups: d.affected.size, affectedScores, warnings: built.warnings };
    if (body.commit === true) {
      await config.setJSON("roster", { students: built.students, updatedAt: new Date().toISOString() });
      return json({ ok: true, committed: true, ...summary });
    }
    return json({ ok: true, committed: false, ...summary });
  }


  const R = await loadRoster(config);
  const me = findStudent(R, body.cls, body.no, body.name);
  if (!me) return bad(WRONG, 401);                      // 거짓 → 다시 작성

  if (env.PERSONAL_CODES && String(env.PERSONAL_CODES).toLowerCase() !== "false") {
    const expected = studentCode(me, env.ADMIN_KEY);
    if (!expected) return bad("서버 설정(입장 코드)이 없습니다.", 500);
    if (normCode(body.code) !== expected) return bad("내 입장 코드가 맞지 않습니다. 선생님께 받은 코드를 입력하세요.", 403);
  } else if (env.ACCESS_CODE && String(body.code ?? "") !== env.ACCESS_CODE) {
    return bad("입장 코드가 맞지 않습니다.", 403);
  }

  if (path === "/api/login") {
    const mine = leaders(R, me.cls).filter((l) => ALLOW_OWN_GROUP || l.group !== me.group);
    return json({ ok: true, student: { cls: me.cls, no: me.no, name: me.name }, leaders: mine });
  }

  const group = Number(body.group);
  if (!Number.isInteger(group) || !leaders(R, me.cls).some((l) => l.group === group)) return bad("조장을 다시 선택하세요.");
  if (!ALLOW_OWN_GROUP && me.group === group) return bad("자기 조는 평가할 수 없습니다. 다른 조장을 선택하세요.");
  const key = `${me.cls}-${me.no}-${group}`;

  if (path === "/api/form") {
    const saved = await store.get(key);               // 본인이 저장한 것만 돌려줌
    return json({
      ok: true, criteria: CRITERIA.map(({ key: k, row, allowed, range }) => ({ key: k, row, allowed, range })),
      members: groupMembers(R, me.cls, group).map(({ slot, name, leader }) => ({ slot, name, leader })),
      scores: saved?.scores || {}, savedAt: saved?.savedAt || null,
    });
  }

  if (path === "/api/submit") {
    const r = cleanScores(R, me.cls, group, body.scores);
    if (r.error) return bad(r.error);
    const rec = { cls: me.cls, no: me.no, name: me.name, group, scores: r.scores, savedAt: new Date().toISOString() };
    await store.setJSON(key, rec);
    return json({ ok: true, savedAt: rec.savedAt });
  }

  return bad("알 수 없는 요청입니다.", 404);
}
