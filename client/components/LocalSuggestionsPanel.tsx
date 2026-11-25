import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Switch, View } from "react-native";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useChatStore } from "@/lib/store";
import {
  SuggestionsStore,
  type Feedback,
  type SuggestionsView,
} from "@/lib/local-suggestions";
import type { MemoryScope } from "@/lib/agent/memory";
const store = new SuggestionsStore();

/** Mobile Settings entry: no chat content is read or passed to the suggestion store. */
export function LocalSuggestionsPanel() {
  const accountId = useChatStore((s) => s.settings.memoryAccountId.trim());
  const chatId = useChatStore((s) => s.currentChatId);
  const exists = useChatStore((s) =>
    s.chats.some((chat) => chat.id === s.currentChatId),
  );
  const scope = useMemo(
    () =>
      accountId && chatId && exists
        ? {
            accountId,
            chatId,
          }
        : undefined,
    [accountId, chatId, exists],
  );
  if (Platform.OS === "web") return null;
  if (!scope)
    return (
      <View style={styles.card}>
        <ThemedText type="h4">Local suggestions</ThemedText>
        <ThemedText>
          Choose a local namespace and an existing chat to use local
          suggestions.
        </ThemedText>
      </View>
    );
  return (
    <ScopedSuggestions
      key={JSON.stringify([accountId, chatId])}
      scope={scope}
    />
  );
}
function ScopedSuggestions({ scope }: { scope: MemoryScope }) {
  const { theme } = useTheme();
  const controller = useRef(new AbortController());
  const [view, setView] = useState<SuggestionsView>();
  const [review, setReview] =
    useState<Awaited<ReturnType<SuggestionsStore["review"]>>>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const current = () => {
    const s = useChatStore.getState();
    return (
      !controller.current.signal.aborted &&
      s.settings.memoryAccountId.trim() === scope.accountId &&
      s.currentChatId === scope.chatId &&
      s.chats.some((c) => c.id === scope.chatId)
    );
  };
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const unsubscribe = useChatStore.subscribe((s) => {
      if (
        s.settings.memoryAccountId.trim() !== scope.accountId ||
        s.currentChatId !== scope.chatId ||
        !s.chats.some((c) => c.id === scope.chatId)
      )
        abort.abort();
    });
    store
      .status(scope, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setView(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => {
      abort.abort();
      unsubscribe();
    };
  }, [scope]);
  const run = async (action: () => Promise<void>) => {
    if (!current() || busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      if (current()) setError(true);
    } finally {
      if (current()) setBusy(false);
    }
  };
  const apply = (operation: () => Promise<SuggestionsView>) =>
    run(async () => {
      const result = await operation();
      if (current()) {
        setView(result);
        setReview(undefined);
      }
    });
  const record = (feedback: Feedback) =>
    apply(() =>
      store.record(scope, view!.epoch, feedback, controller.current.signal),
    );
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundDefault,
        },
      ]}
    >
      <ThemedText type="h4">Local suggestions</ThemedText>
      <ThemedText>
        For the current namespace and chat only. This local namespace is not
        sign-in.
      </ThemedText>
      <ThemedText>
        Optional manual feedback only. No chat text is collected or sent.
        Evidence expires within 7 days. Accepted drafts stay inactive and expire
        after 30 days.
      </ThemedText>
      {error && (
        <ThemedText accessibilityRole="alert">
          Local suggestions unavailable. No success was confirmed; please retry.
        </ThemedText>
      )}
      {!view && !busy && (
        <ActionButton
          id="suggestions-retry"
          label="Retry local suggestions"
          busy={busy}
          onPress={() =>
            apply(() => store.status(scope, controller.current.signal))
          }
        />
      )}
      {view && (
        <>
          <View style={styles.row}>
            <ThemedText>Collect local feedback</ThemedText>
            <Switch
              testID="suggestions-optin"
              accessibilityLabel="Collect local feedback"
              value={view.enabled}
              disabled={busy}
              onValueChange={(enabled) =>
                apply(() =>
                  store.setEnabled(scope, enabled, controller.current.signal),
                )
              }
            />
          </View>
          <ThemedText>{view.observations.length} local observations</ThemedText>
          {view.enabled && (
            <>
              <ActionButton
                id={"suggestions-shorter"}
                label={"Too long"}
                onPress={() => record("shorter")}
                busy={busy}
              />
              <ActionButton
                id={"suggestions-more-detail"}
                label={"Too brief"}
                onPress={() => record("more_detail")}
                busy={busy}
              />
              <ActionButton
                id={"suggestions-length-ok"}
                label={"Length is right"}
                onPress={() => record("length_ok")}
                busy={busy}
              />
              <ThemedText>
                Untrusted proposals — reviewing or saving does not change the
                assistant.
              </ThemedText>
              {view.candidates.map((candidate) => (
                <View key={candidate.kind}>
                  <ThemedText>
                    {candidate.title} · {Math.round(candidate.confidence * 100)}
                    % confidence · {candidate.support} supporting marks
                  </ThemedText>
                  <ActionButton
                    id={`suggestions-review-${candidate.kind}`}
                    label={`Review: ${candidate.title}`}
                    onPress={() =>
                      run(async () => {
                        const result = await store.review(
                          scope,
                          view.revision,
                          candidate.kind,
                          controller.current.signal,
                        );
                        if (current()) setReview(result);
                      })
                    }
                    busy={busy}
                  />
                </View>
              ))}
            </>
          )}
          {review && (
            <View style={styles.review}>
              <ThemedText type="h4">Review untrusted draft</ThemedText>
              <ThemedText>{review.candidate.text}</ThemedText>
              <ThemedText>
                Source: manual mobile feedback. Saving only adds an inactive
                draft for this namespace and chat. It grants no permissions and
                changes no prompts or settings.
              </ThemedText>
              <ActionButton
                id={"suggestions-accept"}
                label={"Save inactive draft"}
                onPress={() =>
                  apply(() =>
                    store.accept(
                      scope,
                      review.ticket,
                      controller.current.signal,
                    ),
                  )
                }
                busy={busy}
              />
              <ActionButton
                id={"suggestions-cancel-review"}
                label={"Cancel review"}
                onPress={() => setReview(undefined)}
                busy={busy}
              />
            </View>
          )}
          <ThemedText type="h4">Inactive accepted drafts</ThemedText>
          {view.drafts.map((draft) => (
            <View key={draft.kind}>
              <ThemedText>{draft.title} — Not active</ThemedText>
              <ThemedText>{draft.text}</ThemedText>
            </View>
          ))}
          <ActionButton
            id={"suggestions-refresh"}
            label={"Refresh proposals"}
            onPress={() =>
              apply(() => store.status(scope, controller.current.signal))
            }
            busy={busy}
          />
          <ActionButton
            id={"suggestions-clear"}
            label={"Delete observations and drafts"}
            onPress={() =>
              apply(() => store.clear(scope, controller.current.signal))
            }
            busy={busy}
          />
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginVertical: 12,
    borderRadius: 12,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  review: {
    gap: 10,
    paddingVertical: 12,
  },
});
function ActionButton({
  id,
  label,
  onPress,
  busy,
}: {
  id: string;
  label: string;
  onPress: () => void | Promise<void>;
  busy: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: theme.primary,
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
