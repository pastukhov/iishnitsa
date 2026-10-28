import { spawnSync } from "node:child_process";
import path from "node:path";

// Run real Node dependencies outside the Expo Jest mocks. A separate process
// also bounds regressions that would otherwise hang Jest's event loop.
function runDependencyCheck(source: string, timeout = 10000) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8",
    timeout,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
}

describe("dependency security and compatibility", () => {
  it("rejects line terminators after shell comment tokens without executing a shell", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      const { createRequire } = require('node:module');
      const { quote } = createRequire(require.resolve('concurrently'))('shell-quote');
      for (const separator of ['\\n', '\\r', '\\u2028', '\\u2029']) {
        assert.throws(() => quote(['echo', { comment: 'note' }, 'a' + separator + 'id;#']), TypeError);
      }
    `);
  });

  it("preserves concurrently argument boundaries and shell metacharacters", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      const path = require('node:path');
      const { ExpandArguments } = require(path.join(path.dirname(require.resolve('concurrently')), 'dist/src/command-parser/expand-arguments.js'));
      const { createRequire } = require('node:module');
      const { parse } = createRequire(require.resolve('concurrently'))('shell-quote');
      const args = ['two words', "it's literal", '$(echo unsafe)', 'a;b', '#comment', 'line\\nbreak'];
      const parser = new ExpandArguments(args);
      assert.deepEqual(parse(parser.parse({ command: 'echo {@}' }).command), ['echo', ...args]);
      assert.deepEqual(parse(parser.parse({ command: 'echo {*}'}).command), ['echo', args.join(' ')]);
    `);
  });

  it("terminates zero-size custom nanoid generators", () => {
    runDependencyCheck(
      `
      const assert = require('node:assert/strict');
      const { customAlphabet, customRandom } = require('nanoid');
      assert.equal(customAlphabet('abc', 0)(), '');
      assert.equal(customAlphabet('abc', 10)(0), '');
      assert.equal(customRandom('abc', 0, size => Buffer.alloc(size))(), '');
    `,
      2000,
    );
  });

  it("preserves React Navigation route keys through push and pop", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      (async () => {
        const { StackRouter, StackActions } = await import('@react-navigation/routers');
        const router = StackRouter({ initialRouteName: 'Chat' });
        const options = { routeNames: ['Chat', 'Settings'], routeParamList: {}, routeGetIdList: {} };
        const initial = router.getInitialState(options);
        const pushed = router.getStateForAction(initial, StackActions.push('Settings'), options);
        assert.equal(pushed.routes[1].name, 'Settings');
        assert.notEqual(pushed.routes[0].key, pushed.routes[1].key);
        assert.equal(pushed.routes[0].key, initial.routes[0].key);
        const popped = router.getStateForAction(pushed, StackActions.pop(), options);
        assert.equal(popped.routes.length, 1);
        assert.equal(popped.routes[0].key, initial.routes[0].key);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `);
  });

  it("preserves chat Markdown tokens, typography and safe link defaults", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      // react-native-markdown-display enables typography for ChatScreen.
      const md = require('markdown-it')({ typographer: true });
      const source = '# Title\\n\\n**bold** and *emphasis*\\n\\n- one\\n  - nested\\n\\n~~~js\\nconst n = 1;\\n~~~\\n\\n[ok](https://example.com)\\n\\n"quoted" <script>alert(1)</script> [bad](javascript:alert(1))';
      const tokens = md.parse(source, {});
      const flat = tokens.flatMap(token => [token, ...(token.children || [])]);
      for (const type of ['heading_open', 'strong_open', 'em_open', 'bullet_list_open', 'fence', 'link_open']) {
        assert(flat.some(token => token.type === type), type);
      }
      const links = flat.filter(token => token.type === 'link_open');
      assert.deepEqual(links.map(token => token.attrGet('href')), ['https://example.com']);
      assert(!flat.some(token => token.type === 'html_inline'));
      assert(flat.some(token => token.content.includes('“quoted”')));
    `);
  });

  it("bounds malformed Markdown reference parsing with renderer options", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      const md = require('markdown-it')({ typographer: true });
      const tokens = md.parse('[a]: /u "' + 'x\\n'.repeat(200000), {});
      assert(tokens.length > 0);
    `);
  });

  it("bounds unmatched smartquotes with the mobile renderer typography enabled", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      const md = require('markdown-it')({ typographer: true });
      const source = '\"a '.repeat(128000) + "b' ".repeat(128000);
      assert(md.parse(source, {}).length > 0);
    `);
  });

  it("keeps brace globbing compatible with every installed minimatch caller", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      const path = require('node:path');
      const lock = require('./package-lock.json');
      const entries = Object.keys(lock.packages).filter(name => name.endsWith('/minimatch'));
      assert(entries.length > 0);
      for (const entry of entries) {
        const exported = require(path.resolve(entry));
        const match = exported.minimatch || exported;
        assert.equal(match('client/file.ts', 'client/*.{ts,tsx}'), true, entry);
        assert.equal(match('client/file.js', 'client/*.{ts,tsx}'), false, entry);
      }
    `);
  });

  it("preserves wait-on HTTP readiness and timeout behavior with real Axios", () => {
    runDependencyCheck(`
      const assert = require('node:assert/strict');
      const http = require('node:http');
      const waitOn = require('wait-on');
      const server = http.createServer((req, res) => {
        res.statusCode = req.url === '/ready' ? 200 : 503;
        res.end();
      });
      server.listen(0, '127.0.0.1', async () => {
        const base = 'http://127.0.0.1:' + server.address().port;
        const options = { interval: 25, window: 0, timeout: 2000, proxy: false };
        try {
          await waitOn({ ...options, resources: [base + '/ready'] });
          await assert.rejects(waitOn({ ...options, timeout: 150, resources: [base + '/unready'] }), /Timed out/);
        } catch (error) { console.error(error); process.exitCode = 1; }
        finally { server.close(); }
      });
    `);
  });
});
