import { getStore } from "@netlify/blobs";
import { handle } from "./handler.mjs";

const wrap = (blobs) => ({
  get: (k) => blobs.get(k, { type: "json" }),
  setJSON: (k, v) => blobs.setJSON(k, v),
  list: async () => (await blobs.list()).blobs.map((b) => b.key),
});

export default async (req) => {
  const store = wrap(getStore("scores"));    // 학생 점수
  const config = wrap(getStore("config"));   // 서버에 올린 명단
  return handle(req, {
    store, config,
    env: {
      ADMIN_KEY: Netlify.env.get("ADMIN_KEY"),
      ACCESS_CODE: Netlify.env.get("ACCESS_CODE"),
      PERSONAL_CODES: Netlify.env.get("PERSONAL_CODES"),
    },
  });
};

export const config = { path: "/api/*" };
