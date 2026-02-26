/**
 * GET /api/admin/check
 * Returns { isAdmin: true/false } based on SIWE session + ADMIN_ADDRESSES whitelist.
 */

import { getSessionAddress } from "../_lib/sessionCookie.js";
import { setCorsHeaders } from "../_lib/cors.js";

function getAdminAddresses() {
  const raw = process.env.ADMIN_ADDRESSES || "";
  return raw
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.startsWith("0x"));
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(200).json({ isAdmin: false });
  }

  const admins = getAdminAddresses();
  const isAdmin = admins.includes(sessionAddress.toLowerCase());
  return res.status(200).json({ isAdmin });
}
