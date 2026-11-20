import type { Command } from "commander";
import { AppError } from "@freebuff/shared";
import { loadConfig } from "./core/config";
import {
  clearCredentials,
  loadCredentials,
  requireCredentials,
  saveCredentials,
} from "./core/credentials";
import { ChatHistoryStore } from "./core/history";
import { defaultAdInventory } from "./core/inventory";
import { chooseDefaultModel, createRegistryFromEnv } from "./core/model-env";
import { resolveCliPaths } from "./core/paths";
import { createLocalPlatform } from "./core/platform";
import { addProject, pickProject, setDefaultProject } from "./core/projects";
import { createHeadlessRenderer } from "./core/render";
import { runChatTurn } from "./core/session";

interface AuthLoginOptions {
  readonly email?: string;
  readonly token?: string;
}

interface ProjectAddOptions {
  readonly name?: string;
}

interface ChatOptions {
  readonly project?: string;
  readonly model?: string;
  readonly continue?: boolean;
  readonly json?: boolean;
  readonly codeMap?: boolean;
}

const out = (text: string): void => {
  process.stdout.write(text);
};

const guard = async (operation: () => Promise<void>): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const message =
      error instanceof AppError || error instanceof Error
        ? error.message
        : "Unexpected error";
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  }
};

const formatHours = (seconds: number): string => (seconds / 3600).toFixed(2);

export const registerCommands = (program: Command): void => {
  const auth = program.command("auth").description("Sign in and out");

  auth
    .command("login")
    .description("Request a magic link, then complete it with --token")
    .option("--email <email>", "email address to sign in with")
    .option("--token <token>", "complete sign-in with a magic link token")
    .action(
      async (options: AuthLoginOptions) =>
        guard(async () => {
          const paths = resolveCliPaths();
          const platform = await createLocalPlatform(paths);

          if (options.token !== undefined) {
            const session = await platform.completeMagicLink(options.token);
            await saveCredentials(paths, {
              token: session.sessionToken,
              userId: session.user.id,
              email: session.user.email,
            });
            out(`Signed in as ${session.user.email}\n`);
            return;
          }

          if (options.email === undefined) {
            throw new AppError({
              code: "validation_failed",
              message: "Pass --email <address>, or --token <token> to finish signing in",
            });
          }

          const link = await platform.requestMagicLink(options.email);
          out(
            [
              `Magic link token (valid until ${link.expiresAt}):`,
              "",
              link.token,
              "",
              "Complete sign-in with:",
              `  freebuff auth login --token ${link.token}`,
              "",
              "Local mode prints the token instead of sending email.",
            ].join("\n") + "\n",
          );
        }),
    );

  auth
    .command("verify <token>")
    .description("Complete sign-in with a magic link token")
    .action(
      async (token: string) =>
        guard(async () => {
          const paths = resolveCliPaths();
          const platform = await createLocalPlatform(paths);
          const session = await platform.completeMagicLink(token);
          await saveCredentials(paths, {
            token: session.sessionToken,
            userId: session.user.id,
            email: session.user.email,
          });
          out(`Signed in as ${session.user.email}\n`);
        }),
    );

  auth
    .command("logout")
    .description("Remove the saved session")
    .action(
      async () =>
        guard(async () => {
          const paths = resolveCliPaths();
          const credentials = await loadCredentials(paths);
          if (credentials !== undefined) {
            const platform = await createLocalPlatform(paths);
            await platform.logout(credentials.token).catch(() => undefined);
          }
          await clearCredentials(paths);
          out("Signed out\n");
        }),
    );

  auth
    .command("phone")
    .description("Verify a phone number for the free tier")
    .option("--phone <phone>", "number in international format, e.g. +14155550123")
    .option("--code <code>", "the six-digit code you received")
    .action(
      async (options: { readonly phone?: string; readonly code?: string }) =>
        guard(async () => {
          if (options.phone === undefined) {
            throw new AppError({
              code: "validation_failed",
              message: "Pass --phone <number> in international format",
            });
          }
          const paths = resolveCliPaths();
          const credentials = await requireCredentials(paths);
          const platform = await createLocalPlatform(paths);
          const user = await platform.verifySession(credentials.token);

          if (options.code === undefined) {
            const challenge = await platform.requestPhoneCode({
              userId: String(user.id),
              phone: options.phone,
            });
            out(
              [
                `Code sent to ${challenge.maskedPhone} (expires ${challenge.expiresAt}).`,
                challenge.delivery === "dev" && challenge.code !== undefined
                  ? `Local mode code: ${challenge.code}`
                  : "Check your messages for the code.",
                "",
                `Verify with: freebuff auth phone --phone ${options.phone} --code <code>`,
              ].join("\n") + "\n",
            );
            return;
          }

          await platform.verifyPhoneCode({
            userId: String(user.id),
            phone: options.phone,
            code: options.code,
          });
          out(`Phone verified. The free tier is available.\n`);
        }),
    );

  auth
    .command("whoami")
    .description("Show the signed-in account and quota")
    .action(
      async () =>
        guard(async () => {
          const paths = resolveCliPaths();
          const credentials = await requireCredentials(paths);
          const platform = await createLocalPlatform(paths);
          const user = await platform.verifySession(credentials.token);
          const config = await loadConfig(paths);
          const quota = await platform.quotaSnapshot({
            userId: user.id,
            plan: user.plan,
            countryCode: config.countryCode,
            phoneVerified: user.phoneVerified,
          });
          out(
            [
              `Email:    ${user.email}`,
              `Plan:     ${user.plan}`,
              `Verified: ${user.phoneVerified ? "yes" : "no"}`,
              `Quota:    ${formatHours(quota.snapshot.consumedSecondsToday)}h of ${String(quota.snapshot.hoursPerDay)}h used today`,
              `Resets:   ${quota.snapshot.resetsAt}`,
            ].join("\n") + "\n",
          );
        }),
    );

  const projects = program.command("projects").description("Manage project folders");

  projects
    .command("add <path>")
    .description("Register a repository folder")
    .option("--name <name>", "display name")
    .action(
      async (path: string, options: ProjectAddOptions) =>
        guard(async () => {
          const paths = resolveCliPaths();
          const result = await addProject(paths, {
            path,
            ...(options.name === undefined ? {} : { name: options.name }),
          });
          out(
            result.created
              ? `Added ${result.project.name} (${result.project.path})\n`
              : `Already added: ${result.project.name} (${result.project.path})\n`,
          );
        }),
    );

  projects
    .command("list")
    .description("List registered projects")
    .action(
      async () =>
        guard(async () => {
          const paths = resolveCliPaths();
          const config = await loadConfig(paths);
          if (config.projects.length === 0) {
            out("No projects yet. Add one with: freebuff projects add <path>\n");
            return;
          }
          for (const project of config.projects) {
            const current =
              config.defaultProjectId !== undefined &&
              String(config.defaultProjectId) === String(project.id)
                ? " *"
                : "";
            out(`${String(project.id)}  ${project.name}${current}  ${project.path}\n`);
          }
        }),
    );

  projects
    .command("use <selector>")
    .description("Set the default project (id, name or path)")
    .action(
      async (selector: string) =>
        guard(async () => {
          const paths = resolveCliPaths();
          const project = await setDefaultProject(paths, selector);
          out(`Default project: ${project.name}\n`);
        }),
    );

  program
    .command("chat [prompt]")
    .description("Start a coding session (interactive TUI, or headless with a prompt)")
    .option("--project <selector>", "project id, name or path")
    .option("--model <modelId>", "model id from the configured catalog")
    .option("--continue", "resume the most recent session for the project")
    .option("--json", "print only the final result as JSON")
    .option("--code-map", "index the repository and expose code-map queries")
    .action(
      async (prompt: string | undefined, options: ChatOptions) =>
        guard(async () => {
          const paths = resolveCliPaths();
          const credentials = await requireCredentials(paths);
          const config = await loadConfig(paths);
          const platform = await createLocalPlatform(paths);
          const user = await platform.verifySession(credentials.token);
          const project = await pickProject(config, {
            ...(options.project === undefined ? {} : { selector: options.project }),
          });
          const registry = createRegistryFromEnv();
          const modelId =
            options.model ?? config.modelId ?? chooseDefaultModel(registry, user.plan);
          const history = new ChatHistoryStore(paths.sessionsDir);
          const resolveModel = (id: string) => ({
            model: registry.get(id),
            maxOutputTokens: registry.descriptor(id).maxOutputTokens,
          });

          if (prompt === undefined) {
            if (process.stdin.isTTY !== true) {
              throw new AppError({
                code: "validation_failed",
                message: 'Pass a prompt to run headlessly: freebuff chat "fix the tests"',
              });
            }
            const { launchInteractive } = await import("./ui/main");
            await launchInteractive({
              platform,
              credentials,
              config,
              project,
              modelId,
              countryCode: config.countryCode,
              history,
              inventory: defaultAdInventory,
              resolveModel,
              isModelAllowed: (id, plan) => registry.isAllowed(id, plan),
            });
            return;
          }

          const renderer = createHeadlessRenderer({ write: out });
          const controller = new AbortController();
          const onSigint = (): void => {
            controller.abort();
          };
          process.once("SIGINT", onSigint);
          try {
            const resumed =
              options.continue === true
                ? (await history.latest(project.id))?.id
                : undefined;
            if (options.json !== true) {
              renderer.info(`Project: ${project.name} (${project.path})`);
              renderer.info(`Model:   ${modelId}`);
              if (resumed !== undefined) {
                renderer.info(`Resumed: ${String(resumed)}`);
              }
            }

            const result = await runChatTurn(
              {
                platform,
                history,
                inventory: defaultAdInventory,
                countryCode: config.countryCode,
                resolveModel,
                isModelAllowed: (id, plan) => registry.isAllowed(id, plan),
                ...(options.json === true
                  ? {}
                  : { onAd: (decision) => renderer.ad(decision) }),
              },
              {
                credentials,
                project,
                prompt,
                modelId,
                signal: controller.signal,
                emit: options.json === true ? () => undefined : renderer.emit,
                ...(resumed === undefined ? {} : { sessionId: resumed }),
                ...(options.codeMap === true ? { useCodeMap: true } : {}),
              },
            );

            if (options.json === true) {
              out(
                `${JSON.stringify({
                  sessionId: result.sessionId,
                  status: result.outcome.status,
                  steps: result.outcome.steps,
                  usage: result.outcome.usage,
                  summary: result.outcome.summary,
                })}\n`,
              );
            } else if (result.outcome.status !== "completed") {
              process.exitCode = result.outcome.status === "cancelled" ? 130 : 1;
            }
          } finally {
            process.removeListener("SIGINT", onSigint);
          }
        }),
    );

  program
    .command("quota")
    .description("Show today's hour quota")
    .action(
      async () =>
        guard(async () => {
          const paths = resolveCliPaths();
          const credentials = await requireCredentials(paths);
          const config = await loadConfig(paths);
          const platform = await createLocalPlatform(paths);
          const user = await platform.verifySession(credentials.token);
          const { snapshot, decision } = await platform.quotaSnapshot({
            userId: user.id,
            plan: user.plan,
            countryCode: config.countryCode,
            phoneVerified: user.phoneVerified,
          });
          out(
            [
              `Plan:      ${snapshot.plan}`,
              `Country:   ${snapshot.countryCode} (${snapshot.timeZone})`,
              `Allowance: ${String(snapshot.hoursPerDay)}h per day`,
              `Used:      ${formatHours(snapshot.consumedSecondsToday)}h`,
              `Resets:    ${snapshot.resetsAt}`,
              `Status:    ${decision.allowed ? "available" : decision.reason}`,
              `Ads:       ${snapshot.adsEnabled ? "shown on the free tier" : "none"}`,
            ].join("\n") + "\n",
          );
        }),
    );
};
