import { proxySkillsRequest } from "../../_proxy.js";

export default function handler(req, res) {
  return proxySkillsRequest(req, res, []);
}
