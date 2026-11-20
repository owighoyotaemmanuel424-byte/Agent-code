/** @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AdDecision, AdInventory } from "@freebuff/ads";
import { selectSponsoredAd } from "@freebuff/ads";
import type { AgentEvent, Plan, RunState } from "@freebuff/shared";
import type { CliConfig, ProjectEntry } from "../core/config";
import type { StoredCredentials } from "../core/credentials";
import type { ChatHistoryStore } from "../core/history";
import { inspectProject } from "../core/projects";
import type { ProjectInspection } from "../core/projects";
import type { ModelHandle } from "../core/session";
import { runChatTurn } from "../core/session";
import type { PlatformClient } from "../core/platform";
import { AD_ROW_HEIGHT } from "./screens/types";
import type { AdNode, BoxNode, ScreenNode } from "./screens/types";
import {
  buildAgentScreen,
  buildModelPickerScreen,
  buildProjectPickerScreen,
  buildQuotaDashboardScreen,
  orderModels,
} from "./screens/screens";
import type { ModelChoice, ProjectCandidate, StreamEntry } from "./screens/screens";
import { AdRow, StaticScreen, StreamView, nodeElement } from "./screens/elements";

export interface AppProps {
  readonly platform: PlatformClient;
  readonly credentials: StoredCredentials;
  readonly config: CliConfig;
  readonly project: ProjectEntry;
  readonly modelId: string;
  readonly countryCode: string;
  readonly plan: Plan;
  readonly models: readonly ModelChoice[];
  readonly recommendedModelId?: string;
  readonly history: ChatHistoryStore;
  readonly inventory: AdInventory;
  readonly resolveModel: (modelId: string) => ModelHandle;
  readonly isModelAllowed: (modelId: string, plan: Plan) => boolean;
  readonly now?: () => Date;
  readonly onQuit: () => void;
  readonly initialStep?: "model" | "project" | "agent" | "quota";
}

type Step = "model" | "project" | "agent" | "quota";

const enterKeys = new Set(["return", "enter", "linefeed"]);
const upKeys = new Set(["up", "k"]);
const downKeys = new Set(["down", "j"]);

const toolTarget = (args: Record<string, unknown>): string | undefined => {
  const path = args["path"];
  if (typeof path === "string") {
    return path;
  }
  const patches = args["patches"];
  if (Array.isArray(patches)) {
    return `${String(patches.length)} files`;
  }
  const command = args["command"];
  if (typeof command === "string") {
    return command;
  }
  return undefined;
};

/** Extract +/- lines from a patch so the stream can show a real diff. */
const diffFromCall = (
  callId: string,
  name: string,
  args: Record<string, unknown>,
): readonly StreamEntry[] => {
  if (name === "edit_file") {
    const path = typeof args["path"] === "string" ? args["path"] : "(unknown file)";
    const before = typeof args["oldString"] === "string" ? args["oldString"].split("\n") : [];
    const after = typeof args["newString"] === "string" ? args["newString"].split("\n") : [];
    return [
      {
        kind: "diff",
        id: `diff-${callId}`,
        path,
        added: after.length,
        removed: before.length,
        lines: [
          ...before.slice(0, 8).map((text) => ({ kind: "removed" as const, text })),
          ...after.slice(0, 8).map((text) => ({ kind: "added" as const, text })),
        ],
      },
    ];
  }
  if (name === "patch_files" && Array.isArray(args["patches"])) {
    const patches = args["patches"].filter(
      (patch): patch is Record<string, unknown> =>
        typeof patch === "object" && patch !== null && "path" in patch,
    );
    return patches.map((patch, index) => {
      const before = typeof patch["oldString"] === "string" ? patch["oldString"].split("\n") : [];
      const after = typeof patch["newString"] === "string" ? patch["newString"].split("\n") : [];
      return {
        kind: "diff" as const,
        id: `diff-${callId}-${String(index)}`,
        path: typeof patch["path"] === "string" ? patch["path"] : "(unknown file)",
        added: after.length,
        removed: before.length,
        lines: [
          ...before.slice(0, 6).map((text) => ({ kind: "removed" as const, text })),
          ...after.slice(0, 6).map((text) => ({ kind: "added" as const, text })),
        ],
      };
    });
  }
  return [];
};

export const App = (props: AppProps): ReactNode => {
  const now = props.now ?? (() => new Date());
  const [step, setStep] = useState<Step>(props.initialStep ?? "model");
  const [project, setProject] = useState<ProjectEntry>(props.project);
  const [modelId, setModelId] = useState(props.modelId);
  const [modelIndex, setModelIndex] = useState(() => {
    const index = orderModels(props.models).findIndex((model) => model.id === props.modelId);
    return index < 0 ? 0 : index;
  });
  const [projectIndex, setProjectIndex] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<readonly StreamEntry[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [ad, setAd] = useState<AdDecision | undefined>(undefined);
  const [inspections, setInspections] = useState<readonly ProjectInspection[]>([]);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const startedAtRef = useRef<number>(0);
  const lastPromptRef = useRef<string | undefined>(undefined);

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

  useEffect(() => {
    let active = true;
    void Promise.all(props.config.projects.map((entry) => inspectProject(entry))).then(
      (result) => {
        if (active) {
          setInspections(result);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [props.config.projects]);

  useEffect(() => {
    if (runState !== "thinking" && runState !== "tool" && runState !== "diff") {
      return undefined;
    }
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [runState]);

  const models = useMemo(() => orderModels(props.models), [props.models]);

  const pickerAd = useMemo(
    () =>
      selectSponsoredAd(
        {
          slot: "cli.startup",
          plan: props.plan,
          topics: [],
          seed: String(props.credentials.userId),
        },
        props.inventory,
      ),
    [props.plan, props.credentials.userId, props.inventory],
  );

  const snapshot = quota.data?.snapshot;

  const submit = useCallback(
    (value: string): void => {
      const prompt = value.trim();
      if (prompt.length === 0 || runState === "thinking" || runState === "tool") {
        return;
      }
      lastPromptRef.current = prompt;
      setNotice(undefined);
      setRunState("thinking");
      setElapsed(0);
      startedAtRef.current = Date.now();
      setEntries((current) => [
        ...current,
        { kind: "message", id: `user-${String(Date.now())}`, role: "user", content: prompt },
      ]);

      const controller = new AbortController();
      controllerRef.current = controller;

      let streamed = "";
      let streamedId = `assistant-${String(Date.now())}`;
      const emit = (event: AgentEvent): void => {
        switch (event.type) {
          case "tool.started":
            setRunState("tool");
            setEntries((current) => [
              ...current,
              { kind: "tool", id: `tool-${String(event.callId)}`, name: event.name, status: "running" },
            ]);
            break;
          case "tool.finished":
            setRunState("diff");
            setEntries((current) =>
              current.map((entry) =>
                entry.kind === "tool" && entry.id === `tool-${String(event.result.callId)}`
                  ? {
                      ...entry,
                      status: event.result.status === "ok" ? "done" : "error",
                    }
                  : entry,
              ),
            );
            break;
          case "message.delta":
            streamed += event.delta;
            setEntries((current) => {
              const existing = current.filter((entry) => entry.id === streamedId);
              if (existing.length > 0) {
                return current.map((entry) =>
                  entry.id === streamedId && entry.kind === "message"
                    ? { ...entry, content: streamed }
                    : entry,
                );
              }
              return [
                ...current,
                { kind: "message", id: streamedId, role: "assistant", content: streamed },
              ];
            });
            break;
          case "message.completed":
            if (event.message.role !== "assistant") {
              return;
            }
            streamedId = `${streamedId}-done`;
            for (const call of event.message.toolCalls ?? []) {
              const target = toolTarget(call.arguments);
              setEntries((current) =>
                current.map((entry) =>
                  entry.kind === "tool" && entry.id === `tool-${String(call.id)}`
                    ? { ...entry, target: target ?? entry.target }
                    : entry,
                ),
              );
              const diffs = diffFromCall(String(call.id), call.name, call.arguments);
              if (diffs.length > 0) {
                setEntries((current) => [...current, ...diffs]);
              }
            }
            break;
          default:
            break;
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
          project,
          prompt,
          modelId,
          signal: controller.signal,
          emit,
          surface: "cli",
        },
      )
        .then((result) => {
          setRunState(result.outcome.status === "completed" ? "done" : "error");
          if (result.outcome.status === "completed") {
            setEntries((current) =>
              current.some((entry) => entry.kind === "message" && entry.role === "assistant")
                ? current
                : [
                    ...current,
                    {
                      kind: "message",
                      id: `summary-${String(Date.now())}`,
                      role: "assistant",
                      content: result.outcome.summary.length > 0 ? result.outcome.summary : "(completed)",
                    },
                  ],
            );
          } else {
            setEntries((current) => [
              ...current,
              {
                kind: "error",
                id: `error-${String(Date.now())}`,
                message:
                  result.outcome.summary.length > 0
                    ? result.outcome.summary
                    : `run ${result.outcome.status}${result.outcome.errorCode === undefined ? "" : `: ${result.outcome.errorCode}`}`,
                retryKey: "r",
              },
            ]);
          }
          setAd(undefined);
        })
        .catch((caught: unknown) => {
          setRunState("error");
          setEntries((current) => [
            ...current,
            {
              kind: "error",
              id: `error-${String(Date.now())}`,
              message: caught instanceof Error ? caught.message : "Run failed",
              retryKey: "r",
            },
          ]);
        })
        .finally(() => {
          void quota.refetch();
        });
    },
    [modelId, project, props, quota, runState],
  );

  const quitOrCancel = useCallback((): void => {
    controllerRef.current?.abort();
    props.onQuit();
  }, [props]);

  const chooseModel = useCallback(
    (index: number): void => {
      const choice = models[index];
      if (choice === undefined) {
        return;
      }
      if (!choice.allowed) {
        setNotice(`The ${choice.displayName} model is part of the paid plan.`);
        return;
      }
      setModelId(choice.id);
      setNotice(undefined);
      lastPromptRef.current = undefined;
      setStep("project");
    },
    [models],
  );

  const candidates: readonly ProjectCandidate[] = useMemo(
    () =>
      props.config.projects.map((entry, index) => {
        const inspection = inspections[index];
        return {
          id: String(entry.id),
          name: entry.name,
          path: entry.path,
          ...(inspection?.branch === undefined ? {} : { branch: inspection.branch }),
          ...(inspection?.reason === undefined ? {} : { problem: inspection.reason }),
          ...(inspection?.recovery === undefined ? {} : { recovery: inspection.recovery }),
        };
      }),
    [props.config.projects, inspections],
  );

  const chooseProject = useCallback(
    (index: number): void => {
      const selected = props.config.projects[index];
      if (selected === undefined) {
        return;
      }
      const inspection = inspections[index];
      if (inspection?.reason !== undefined && inspection.recovery !== undefined) {
        setNotice(inspection.recovery);
      }
      setProject(selected);
      setStep("agent");
    },
    [inspections, props.config.projects],
  );

  useKeyboard((key) => {
    if (key.name === "escape") {
      quitOrCancel();
      return;
    }
    if (step === "model") {
      if (upKeys.has(key.name)) {
        setModelIndex((current) => (current === 0 ? models.length - 1 : current - 1));
        return;
      }
      if (downKeys.has(key.name)) {
        setModelIndex((current) => (current + 1) % Math.max(1, models.length));
        return;
      }
      if (enterKeys.has(key.name)) {
        chooseModel(modelIndex);
        return;
      }
      if (key.name === "q") {
        quitOrCancel();
      }
      return;
    }
    if (step === "project") {
      if (upKeys.has(key.name)) {
        setProjectIndex((current) =>
          current === 0 ? Math.max(0, props.config.projects.length - 1) : current - 1,
        );
        return;
      }
      if (downKeys.has(key.name)) {
        setProjectIndex((current) =>
          props.config.projects.length === 0
            ? 0
            : (current + 1) % props.config.projects.length,
        );
        return;
      }
      if (enterKeys.has(key.name)) {
        chooseProject(projectIndex);
        return;
      }
      if (key.name === "n" || key.name === "r") {
        setNotice(
          "Register a folder with: freebuff projects add <path> — the picker stays open.",
        );
        return;
      }
      if (key.name === "q") {
        quitOrCancel();
      }
      return;
    }
    if (key.ctrl === true && key.name === "u") {
      setStep(step === "quota" ? "agent" : "quota");
      return;
    }
    if (
      key.ctrl === true &&
      key.name === "r" &&
      runState === "error" &&
      lastPromptRef.current !== undefined
    ) {
      submit(lastPromptRef.current);
    }
  });

  if (step === "quota" && snapshot !== undefined) {
    const quotaScreen = buildQuotaDashboardScreen({
      plan: snapshot.plan,
      countryCode: snapshot.countryCode,
      timeZone: snapshot.timeZone,
      hoursPerDay: snapshot.hoursPerDay,
      consumedSeconds: snapshot.consumedSecondsToday,
      resetsAt: snapshot.resetsAt,
      now: now(),
      unlimitedModels: models.filter((model) => model.allowed).map((model) => model.displayName),
      meteredModels: models.filter((model) => !model.allowed).map((model) => model.displayName),
      ...(pickerAd === undefined ? {} : { ad: pickerAd.ad }),
    });
    return (
      <box flexDirection="column" style={{ padding: 1, height: "100%" }}>
        <StaticScreen screen={quotaScreen} />
        <text fg="#9aa5b8">u back to the agent · Esc quits</text>
      </box>
    );
  }

  if (step === "model") {
    const screen = buildModelPickerScreen({
      models: props.models,
      plan: props.plan,
      selected: modelIndex,
      ...(props.recommendedModelId === undefined ? {} : { recommendedId: props.recommendedModelId }),
      ...(pickerAd === undefined ? {} : { ad: pickerAd.ad }),
      ...(notice === undefined ? {} : { notice }),
    });
    return (
      <box flexDirection="column" style={{ padding: 1, height: "100%" }}>
        <StaticScreen screen={screen} />
      </box>
    );
  }

  if (step === "project") {
    const screen = buildProjectPickerScreen({
      projects: candidates,
      selected: projectIndex,
      ...(pickerAd === undefined ? {} : { ad: pickerAd.ad }),
      ...(notice === undefined ? {} : { notice }),
    });
    return (
      <box flexDirection="column" style={{ padding: 1, height: "100%" }}>
        <StaticScreen screen={screen} />
      </box>
    );
  }

  const agentScreen = buildAgentScreen({
    modelId,
    projectName: project.name,
    entries,
    state: runState,
    elapsedSeconds: elapsed,
    consumedSeconds: snapshot?.consumedSecondsToday ?? 0,
    hoursPerDay: snapshot?.hoursPerDay ?? 0,
    ...(ad === undefined ? {} : { ad: ad.ad }),
  });
  const streamNode = agentScreen.children.find(
    (node): node is BoxNode => node.kind === "box" && node.region === "stream",
  );
  const composerNode = agentScreen.children.find(
    (node): node is BoxNode => node.kind === "box" && node.region === "composer",
  );
  const statusNode: ScreenNode | undefined = agentScreen.children.find(
    (node) => node.kind === "text" && node.id === "status",
  );
  const adNode: AdNode | undefined =
    ad === undefined
      ? undefined
      : {
          kind: "ad",
          id: "agent-ad",
          region: "ad",
          height: AD_ROW_HEIGHT,
          ad: ad.ad,
        };

  return (
    <box flexDirection="column" style={{ padding: 1, height: "100%" }}>
      {streamNode === undefined ? null : <StreamView node={streamNode} />}
      {adNode === undefined ? null : <AdRow node={adNode} />}
      <box
        border
        borderStyle="rounded"
        title={composerNode?.title ?? "Prompt"}
        height={3}
        style={{ paddingLeft: 1, paddingRight: 1, flexShrink: 0 }}
      >
        <input
          placeholder="Describe the change"
          focused={runState !== "thinking" && runState !== "tool"}
          onSubmit={(value: string) => submit(value)}
        />
      </box>
      {statusNode === undefined ? null : nodeElement(statusNode)}
      {notice === undefined ? null : <text fg="#fbbf24">{notice}</text>}
    </box>
  );
};
