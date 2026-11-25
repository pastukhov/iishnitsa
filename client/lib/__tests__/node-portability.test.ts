import { execFileSync } from "node:child_process";
import path from "node:path";

it("imports shared runtime dependencies and uses isolated injected storage in real Node", () => {
  const source = `
    import { sendChatMessage } from "./client/lib/api.ts";
    import { MemoryStore } from './client/lib/agent/memory.ts';
    import { buildAgentContext } from './client/lib/agent/context-manager.ts';
    import { MCPClient } from './client/lib/mcp-client.ts';
    import { getQueuedChatRequests } from './client/lib/offline-queue.ts';
    import assert from 'node:assert/strict';
    const makeStorage = () => {
      const values = new Map();
      return {getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }};
    };
    async function main() {
      const storage = makeStorage();
      const first = new MemoryStore(storage);
      const second = new MemoryStore(storage);
      const isolated = new MemoryStore(makeStorage());
      const scope = {accountId:'test', chatId:'chat'};
      await first.addMemory({scope, provenance:{source:'explicit',sourceId:'message'}, type:'fact', content:'reference',importance:0.5});
      assert.equal((await second.listMemories(scope)).length,1);
      assert.equal((await isolated.listMemories(scope)).length,0);
      const messages = await buildAgentContext({messages:[{id:'one',role:'user',content:'hello',timestamp:1}], endpoint:{providerId:'custom',baseUrl:'https://fake.invalid',apiKey:'fake',model:'fake'}});
      assert.deepEqual(messages,[{role:'user',content:'hello'}]);
      assert.equal(typeof sendChatMessage, 'function');
      assert.equal(typeof MCPClient, 'function');
      assert.equal(typeof getQueuedChatRequests, 'function');
      process.stdout.write('portable');
    }
    main().catch(error => { process.stderr.write(String(error));process.exitCode=1; });
  `;
  expect(
    execFileSync(
      process.execPath,
      [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "-e", source],
      { cwd: process.cwd(), encoding: "utf8", timeout: 20000 },
    ),
  ).toBe("portable");
}, 25000);

it("initializes MCP in real Node using only a fake transport and bundled app metadata", () => {
  const source = `
    import { MCPClient } from './client/lib/mcp-client.ts';
    import config from './app.json';
    import assert from 'node:assert/strict';
    const requests = [];
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://mcp.invalid/rpc');
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.method === 'notifications/initialized') return new Response(null, {status:204});
      assert.equal(request.method, 'initialize');
      return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2024-11-05',serverInfo:{name:'fake'},capabilities:{}}}), {status:200,headers:{'content-type':'application/json'}});
    };
    async function main() {
      const client = new MCPClient({id:'fake',name:'Fake',url:'https://mcp.invalid/rpc',enabled:true});
      const result = await client.initialize();
      assert.equal(result.serverInfo.name,'fake');
      assert.equal(client.isInitialized(),true);
      assert.equal(requests.length,2);
      assert.deepEqual(requests[0].params.clientInfo,{name:config.expo.name,version:config.expo.version});
      assert.equal(await client.initialize(),result);
      assert.equal(requests.length,2);
      process.stdout.write('mcp portable');
    }
    main().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});
  `;
  expect(
    execFileSync(
      process.execPath,
      [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "-e", source],
      { cwd: process.cwd(), encoding: "utf8", timeout: 20000 },
    ),
  ).toBe("mcp portable");
}, 25000);
