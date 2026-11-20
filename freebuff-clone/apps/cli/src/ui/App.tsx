/** @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import type { SelectOption } from "@opentui/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AdDecision, AdInventory } from "@freebuff/ads";
import { formatSponsoredAd } from "@freebuff/ads";
import type { AgentEvent, Plan } from "@freebuff/shared";
import type { CliConfig, ProjectEntry } from "../core/config";
import type { StoredCredentials } from "../core/credentials";
import type { ChatHistoryStore } from "../core/history";
import type { ModelHandle } from "../core/session";
import { runChatTurn } from "../core/session";
import type { PlatformClient } from "../core/platform";

interface ChatLine {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AppProps {
  readonly platform: PlatformClient;
  readonly credentials: StoredCredentials;
  readonly config: CliConfig;
  readonly project: ProjectEntry;
  readonly modelId: string;
  readonly countryCode: string;
  readonly history: ChatHistoryStore;
  readonly inventory: AdInventory;
  readonly resolveModel: (modelId: string) => ModelHandle;
  readonly isModelAllowed: (modelId: string, plan: Plan) => boolean;
  readonly onQuit: () => void;
}

const formatHours = (seconds: number): string => (seconds / 3600).toFixed(2);

export const App = (props: AppProps): ReactNode => {
  const [project, setProject] = useState<ProjectEntry | undefined>(
    props.config.projects.length > 1 ? undefined : props.project,
  );
  const [lines, setLines] = useState<readonly ChatLine[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [ad, setAd] = useState<AdDecision | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  const quota = useQuery({
    queryKey: ["quota", String(props.credentials.userId), props.countryCode],
    queryFn: async () => {
      const user = await props.platform.verifySession(props.credentials.token);
      return props.platform.quotaSnapshot({
        userId: user.id,
        plan: user.plan,
        countryCode: props.countryCode,
        phoneVerified: user.phoneVerified,
      });
    },
    refetchInterval: 30_000,
  });

  const projects = useQuery({
    queryKey: ["projects", String(props.credentials.userId)],
    queryFn: async () => props.config.projects,
    staleTime: Infinity,
  });

  useKeyboard((key) => {
    if (key.name === "escape") {
      controllerRef.current?.abort();
      props.onQuit();
    }
  });

  const options = useMemo<SelectOption[]>(
    () =>
      (projects.data ?? props.config.projects).map((entry) => ({
        name: entry.name,
        description: entry.path,
        value: String(entry.id),
      })),
    [projects.data, props.config.projects],
  );

  const chooseProject = useCallback(
    (index: number): void => {
      const selected = (projects.data ?? props.config.projects)[index];
      if (selected === undefined) {
        return;
      }
      setProject(selected);
      setError(undefined);
      void props.history
        .latest(selected.id)
        .then((meta) => (meta === undefined ? undefined : props.history.load(meta.id)))
        .then((session) => {
          if (session === undefined) {
            return;
          }
          setLines(
            session.messages
              .filter(
                (message) =>
                  message.role === "user" || message.role === "assistant",
              )
              .map((message) => ({
                id: message.id,
                role: message.role === "user" ? "user" : "assistant",
                content: message.content,
              })),
          );
        })
        .catch(() => undefined);
    },
    [projects.data, props.config.projects, props.history],
  );

  const submit = useCallback(
    (value: string): void => {
      const prompt = value.trim();
      const active = project;
      if (prompt.length === 0 || active === undefined || busy) {
        return;
      }
      setError(undefined);
      setBusy(true);
      setStreaming("");
      setLines((current) => [
        ...current,
        { id: `user-${String(Date.now())}`, role: "user", content: prompt },
      ]);

      const controller = new AbortController();
      controllerRef.current = controller;

      let answer = "";
      const emit = (event: AgentEvent): void => {
        if (event.type === "message.delta") {
          answer += event.delta;
          setStreaming(answer);
        }
      };

      void runChatTurn(
        {
          platform: props.platform,
          history: props.history,
          inventory: props.inventory,
          countryCode: props.countryCode,
          resolveModel: props.resolveModel,
          isModelAllowed: props.isModelAllowed,
          onAd: (decision) => setAd(decision),
        },
        {
          credentials: props.credentials,
          project: active,
          prompt,
          modelId: props.modelId,
          signal: controller.signal,
          emit,
          surface: "cli",
        },
      )
        .then((result) => {
          setLines((current) => [
            ...current,
            {
              id: `assistant-${String(Date.now())}`,
              role: "assistant",
              content:
                result.outcome.summary.length > 0
                  ? result.outcome.summary
                  : `(${result.outcome.status})`,
            },
          ]);
          setAd(undefined);
          if (result.outcome.status === "failed") {
            setError(result.outcome.errorCode ?? "run failed");
          }
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : "Run failed");
        })
        .finally(() => {
          setBusy(false);
          setStreaming("");
          void quota.refetch();
        });
    },
    [busy, project, props, quota],
  );

  const snapshot = quota.data?.snapshot;

  return (
    <box flexDirection="column" style={{ padding: 1, height: "100%" }}>
      <box
        border
        borderStyle="rounded"
        title="freebuff"
        style={{ height: 3, paddingLeft: 1, paddingRight: 1 }}
      >
        <text>
          <strong>{project?.name ?? "choose a project"}</strong> · {props.modelId}
          {snapshot === undefined
            ? ""
            : ` · ${formatHours(snapshot.consumedSecondsToday)}h / ${String(snapshot.hoursPerDay)}h today`}
        </text>
      </box>

      {project === undefined ? (
        <box border title="Choose a project" style={{ height: 12, marginTop: 1 }}>
          <select
            options={options}
            focused
            onChange={(index: number) => chooseProject(index)}
          />
        </box>
      ) : (
        <>
          <scrollbox focused style={{ flexGrow: 1, marginTop: 1 }}>
            {lines.map((line) => (
              <box key={line.id} style={{ marginBottom: 1 }}>
                <text>
                  <strong>{line.role === "user" ? "you" : "freebuff"}:</strong>{" "}
                  {line.content}
                </text>
              </box>
            ))}
            {streaming.length > 0 ? <text fg="cyan">{streaming}</text> : null}
            {ad === undefined ? null : (
              <box border title="Sponsored" style={{ marginTop: 1, paddingLeft: 1 }}>
                <text fg="yellow">{formatSponsoredAd(ad.ad).join("\n")}</text>
              </box>
            )}
            {error === undefined ? null : <text fg="red">error: {error}</text>}
          </scrollbox>

          <box border title={busy ? "Working…" : "Prompt"} style={{ height: 3 }}>
            <input
              placeholder="Describe the change"
              focused={!busy}
              onSubmit={(value: string) => submit(value)}
            />
          </box>
        </>
      )}

      <text fg="gray">Esc cancels the run and quits</text>
    </box>
  );
};
