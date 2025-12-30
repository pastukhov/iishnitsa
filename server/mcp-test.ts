const BASE_URL = "http://localhost:5000/api/mcp";

interface MCPTestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<MCPTestResult> {
  const start = Date.now();
  try {
    await testFn();
    return { name, passed: true, duration: Date.now() - start };
  } catch (error: any) {
    return {
      name,
      passed: false,
      error: error.message,
      duration: Date.now() - start,
    };
  }
}

async function sendMCPRequest(
  method: string,
  params?: any,
  sessionId?: string
): Promise<{ result: any; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const newSessionId = response.headers.get("Mcp-Session-Id");
  const json = await response.json();

  if (json.error) {
    throw new Error(json.error.message);
  }

  return { result: json.result, sessionId: newSessionId };
}

async function testInitialize(): Promise<void> {
  const { result, sessionId } = await sendMCPRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Test Client", version: "1.0.0" },
  });

  if (!sessionId) {
    throw new Error("No session ID returned");
  }
  if (result.protocolVersion !== "2024-11-05") {
    throw new Error(`Wrong protocol version: ${result.protocolVersion}`);
  }
  if (!result.serverInfo?.name) {
    throw new Error("Missing server info");
  }
}

async function testListTools(): Promise<void> {
  const { sessionId } = await sendMCPRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Test Client", version: "1.0.0" },
  });

  const { result } = await sendMCPRequest("tools/list", undefined, sessionId!);

  if (!Array.isArray(result.tools)) {
    throw new Error("tools/list did not return array");
  }
  if (result.tools.length !== 3) {
    throw new Error(`Expected 3 tools, got ${result.tools.length}`);
  }

  const toolNames = result.tools.map((t: any) => t.name);
  if (!toolNames.includes("get_weather")) {
    throw new Error("Missing get_weather tool");
  }
  if (!toolNames.includes("calculate")) {
    throw new Error("Missing calculate tool");
  }
  if (!toolNames.includes("search_web")) {
    throw new Error("Missing search_web tool");
  }
}

async function testToolCallWeather(): Promise<void> {
  const { sessionId } = await sendMCPRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Test Client", version: "1.0.0" },
  });

  const { result } = await sendMCPRequest(
    "tools/call",
    {
      name: "get_weather",
      arguments: { location: "Moscow" },
    },
    sessionId!
  );

  if (!result.content || !Array.isArray(result.content)) {
    throw new Error("Invalid tool result format");
  }
  if (!result.content[0].text.includes("Moscow")) {
    throw new Error("Weather result does not include location");
  }
}

async function testToolCallCalculate(): Promise<void> {
  const { sessionId } = await sendMCPRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Test Client", version: "1.0.0" },
  });

  const { result } = await sendMCPRequest(
    "tools/call",
    {
      name: "calculate",
      arguments: { expression: "2 + 2 * 3" },
    },
    sessionId!
  );

  if (!result.content[0].text.includes("8")) {
    throw new Error(`Wrong calculation result: ${result.content[0].text}`);
  }
}

async function testSessionRequired(): Promise<void> {
  try {
    await sendMCPRequest("tools/list");
    throw new Error("Should have required session");
  } catch (error: any) {
    if (!error.message.includes("Session-Id")) {
      throw error;
    }
  }
}

async function testAcceptHeaderRequired(): Promise<void> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    }),
  });

  if (response.status !== 406) {
    throw new Error(`Expected 406, got ${response.status}`);
  }
}

async function testHealthEndpoint(): Promise<void> {
  const response = await fetch(`${BASE_URL}/health`);
  const json = await response.json();

  if (json.status !== "ok") {
    throw new Error("Health check failed");
  }
  if (!Array.isArray(json.tools)) {
    throw new Error("Missing tools in health response");
  }
}

async function runAllTests(): Promise<void> {
  console.log("\n=== MCP Client E2E Tests ===\n");

  const tests = [
    runTest("Initialize and get session", testInitialize),
    runTest("List tools", testListTools),
    runTest("Tool call: get_weather", testToolCallWeather),
    runTest("Tool call: calculate", testToolCallCalculate),
    runTest("Session ID required", testSessionRequired),
    runTest("Accept header required", testAcceptHeaderRequired),
    runTest("Health endpoint", testHealthEndpoint),
  ];

  const results = await Promise.all(tests);

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`${status} ${result.name} (${result.duration}ms)`);
    if (!result.passed && result.error) {
      console.log(`     Error: ${result.error}`);
    }
    if (result.passed) passed++;
    else failed++;
  }

  console.log(`\n=== Results: ${passed}/${results.length} passed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
