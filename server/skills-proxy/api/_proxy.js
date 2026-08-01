import { getVercelOidcToken } from "@vercel/oidc";

const UPSTREAM_BASE = "https://skills.sh/api/v1/skills";

export function buildUpstreamUrl(pathSegments, query) {
  const segments = pathSegments.filter(Boolean).map(encodeURIComponent);
  const upstreamPath = segments.join("/");

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      value.forEach((v) => search.append(key, v));
    } else if (value !== undefined) {
      search.append(key, value);
    }
  }
  const qs = search.toString();

  return `${UPSTREAM_BASE}${upstreamPath ? `/${upstreamPath}` : ""}${qs ? `?${qs}` : ""}`;
}

export async function proxySkillsRequest(req, res, pathSegments) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Only GET is supported.",
    });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(pathSegments, req.query);

  let token;
  try {
    token = await getVercelOidcToken();
  } catch (_error) {
    res.status(500).json({
      error: "oidc_token_unavailable",
      message:
        "Could not obtain a Vercel OIDC token. Is OIDC Federation enabled for this project?",
    });
    return;
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_error) {
    res.status(503).json({
      error: "upstream_unreachable",
      message: "Failed to reach skills.sh.",
    });
    return;
  }

  const body = await upstreamRes.text();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  const cacheControl = upstreamRes.headers.get("cache-control");
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }
  res.setHeader(
    "Content-Type",
    upstreamRes.headers.get("content-type") || "application/json",
  );

  res.status(upstreamRes.status).send(body);
}
