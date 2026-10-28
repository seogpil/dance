import { getStore } from "@netlify/blobs";
import { handle } from "./handler.mjs";

export default async (req) => {
  const blobs = getStore("scores");
  const store = {
    get: (k) => blobs.get(k, { type: "json" }),
    setJSON: (k, v) => blobs.setJSON(k, v),
    list: async () => (await blobs.list()).blobs.map((b) => b.key),
  };
  return handle(req, { store, env: { ADMIN_KEY: Netlify.env.get("ADMIN_KEY"), ACCESS_CODE: Netlify.env.get("ACCESS_CODE") } });
};

export const config = { path: "/api/*" };
