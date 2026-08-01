import { proxySkillsRequest } from "../../_proxy.js";

export default function handler(req, res) {
  const { path } = req.query;
  const segments = Array.isArray(path) ? path : path ? [path] : [];
  return proxySkillsRequest(req, res, segments);
}
