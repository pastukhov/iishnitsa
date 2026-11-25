import { beforeEach, afterEach, it, expect, jest } from "@jest/globals";
import type { Mock } from "jest-mock";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Platform, Switch } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useChatStore } from "../../lib/store";
import { LocalSuggestionsPanel } from "../LocalSuggestionsPanel";
let renderer: ReactTestRenderer;
let values: Map<string, string>;
const original = useChatStore.getState().settings;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => {
  values = new Map();
  jest.clearAllMocks();
  (
    AsyncStorage.getItem as Mock<(key: string) => Promise<string | null>>
  ).mockImplementation(async (key: string) => values.get(key) ?? null);
  (
    AsyncStorage.setItem as Mock<(key: string, value: string) => Promise<void>>
  ).mockImplementation(async (key: string, value: string) => {
    values.set(key, value);
  });
  useChatStore.setState({
    settings: { ...original, memoryAccountId: "fixture-account" },
    currentChatId: "fixture-chat",
    chats: [
      {
        id: "fixture-chat",
        title: "PRIVATE chat text",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ] as any,
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  jest.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    renderer = create(<LocalSuggestionsPanel />);
    await flush();
  });
}
async function press(id: string) {
  await act(async () => {
    await renderer.root
      .findAll((n) => typeof n.props.onPress === "function")
      .find((n) => n.props.testID === id)!
      .props.onPress();
    await flush();
  });
}
async function enable(value: boolean) {
  await act(async () => {
    await renderer.root.findByType(Switch).props.onValueChange(value);
    await flush();
  });
}
const output = () => JSON.stringify(renderer.toJSON());
it("uses the actual mobile panel for opt-in, review and inactive promotion", async () => {
  await mount();
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await enable(true);
  await press("suggestions-shorter");
  await press("suggestions-shorter");
  await press("suggestions-shorter");
  expect(output()).toContain("Consider shorter replies");
  expect(output()).not.toContain("PRIVATE chat text");
  await press("suggestions-review-concise");
  expect(output()).toContain(
    "A preference for concise replies may be worth reviewing.",
  );
  await press("suggestions-accept");
  expect(output()).toContain("Inactive accepted drafts");
  expect(output()).toContain("Not active");
  expect(useChatStore.getState().settings).toEqual({
    ...original,
    memoryAccountId: "fixture-account",
  });
  expect([...values.keys()]).toEqual(["@local_suggestions_v1"]);
  expect(JSON.stringify([...values])).not.toMatch(
    /PRIVATE|apiKey|https:|prompt/,
  );
});
it("opt-out removes feedback controls and explicit deletion removes all derivatives", async () => {
  await mount();
  await enable(true);
  await press("suggestions-shorter");
  await press("suggestions-shorter");
  await press("suggestions-review-concise");
  await press("suggestions-accept");
  await enable(false);
  expect(output()).not.toContain('"testID":"suggestions-shorter"');
  await press("suggestions-clear");
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
  expect(output()).not.toContain("Not active");
  expect(JSON.parse([...values.values()][0]).scopes).toEqual([]);
});
it("scope switch clears review and does not expose another chat's data", async () => {
  await mount();
  await enable(true);
  await press("suggestions-shorter");
  await press("suggestions-shorter");
  await press("suggestions-review-concise");
  await act(async () => {
    useChatStore.setState({
      settings: { ...original, memoryAccountId: "other-account" },
    });
    await flush();
  });
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
  expect(output()).not.toContain('"testID":"suggestions-accept"');
});
it("deleting the current chat aborts an observation waiting for storage", async () => {
  await mount();
  await enable(true);
  const raw = [...values.values()][0];
  let resolve!: (value: string) => void;
  (
    AsyncStorage.getItem as Mock<(key: string) => Promise<string | null>>
  ).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let pending: Promise<void>;
  await act(async () => {
    pending = renderer.root
      .findAll((n) => typeof n.props.onPress === "function")
      .find((n) => n.props.testID === "suggestions-shorter")!
      .props.onPress();
    await flush();
  });
  await act(async () => {
    useChatStore.setState({ chats: [], currentChatId: null });
    resolve(raw);
    await pending;
    await flush();
  });
  expect(output()).toContain("Choose a local namespace and an existing chat");
  expect(JSON.parse([...values.values()][0]).scopes[0].observations).toEqual(
    [],
  );
});
it("does not show acceptance success when persistence fails", async () => {
  await mount();
  await enable(true);
  await press("suggestions-shorter");
  await press("suggestions-shorter");
  await press("suggestions-review-concise");
  (
    AsyncStorage.setItem as Mock<(key: string, value: string) => Promise<void>>
  ).mockRejectedValueOnce(Error("PRIVATE storage token"));
  await press("suggestions-accept");
  expect(output()).toContain("Local suggestions unavailable");
  expect(output()).not.toContain("PRIVATE");
  expect(output()).not.toContain("Not active");
});
it("preserves an in-flight mark across an unrelated parent render", async () => {
  await mount();
  await enable(true);
  const raw = [...values.values()][0];
  let resolve!: (value: string) => void;
  (
    AsyncStorage.getItem as Mock<(key: string) => Promise<string | null>>
  ).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = renderer.root
      .findAll((n) => typeof n.props.onPress === "function")
      .find((n) => n.props.testID === "suggestions-shorter")!
      .props.onPress();
    await flush();
  });
  await act(async () => {
    renderer.update(<LocalSuggestionsPanel />);
    await flush();
  });
  await act(async () => {
    resolve(raw);
    await pending;
    await flush();
  });
  expect(
    JSON.parse([...values.values()][0]).scopes[0].observations,
  ).toHaveLength(1);
  expect(output()).not.toContain("Local suggestions unavailable");
});
it("offers a safe retry after initial storage failure", async () => {
  (
    AsyncStorage.getItem as Mock<(key: string) => Promise<string | null>>
  ).mockRejectedValueOnce(Error("private failure"));
  await mount();
  expect(output()).toContain("Local suggestions unavailable");
  await press("suggestions-retry");
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
  expect(output()).not.toContain("Local suggestions unavailable");
});
it("allows review cancellation and refresh without promotion", async () => {
  await mount();
  await enable(true);
  await press("suggestions-more-detail");
  await press("suggestions-more-detail");
  await press("suggestions-review-detailed");
  await press("suggestions-cancel-review");
  await press("suggestions-refresh");
  expect(output()).not.toContain('"testID":"suggestions-accept"');
  expect(output()).not.toContain("Not active");
  await press("suggestions-length-ok");
  expect(output()).not.toContain("Consider more detail");
});
it("does not expose a web collection surface", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  await mount();
  expect(renderer.toJSON()).toBeNull();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});
it("keeps collection unavailable without an explicit local namespace", async () => {
  useChatStore.setState({ settings: { ...original, memoryAccountId: "" } });
  await mount();
  expect(output()).toContain("Choose a local namespace");
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});
it("discards a delayed initial snapshot after switching chats", async () => {
  let resolve!: (value: null) => void;
  (
    AsyncStorage.getItem as Mock<(key: string) => Promise<string | null>>
  ).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await mount();
  await act(async () => {
    useChatStore.setState({
      currentChatId: "other",
      chats: [{ id: "other", messages: [] }] as any,
    });
    resolve(null);
    await flush();
  });
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
  expect(output()).not.toContain("Local suggestions unavailable");
});
it("ignores a retained handler after the namespace changes", async () => {
  await mount();
  await enable(true);
  const old = renderer.root
    .findAll((n) => typeof n.props.onPress === "function")
    .find((n) => n.props.testID === "suggestions-shorter")!.props.onPress;
  await act(async () => {
    useChatStore.setState({
      settings: { ...original, memoryAccountId: "other" },
    });
    await flush();
  });
  await act(async () => {
    await old();
    await flush();
  });
  expect(JSON.parse([...values.values()][0]).scopes[0].observations).toEqual(
    [],
  );
});
it("does not display a completed old-scope write after switching namespace", async () => {
  await mount();
  await enable(true);
  let release!: () => void;
  (
    AsyncStorage.setItem as Mock<(key: string, value: string) => Promise<void>>
  ).mockImplementationOnce(async (key, value) => {
    await new Promise<void>((r) => {
      release = r;
    });
    values.set(key, value);
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = renderer.root
      .findAll((n) => typeof n.props.onPress === "function")
      .find((n) => n.props.testID === "suggestions-shorter")!
      .props.onPress();
    await flush();
  });
  await act(async () => {
    useChatStore.setState({
      settings: { ...original, memoryAccountId: "other" },
    });
    release();
    await pending;
    await flush();
  });
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
  expect(output()).not.toContain("Local suggestions unavailable");
});
