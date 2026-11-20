import { homedir } from "node:os";
import { join } from "node:path";

export interface CliPaths {
  readonly root: string;
  readonly configFile: string;
  readonly credentialsFile: string;
  readonly stateFile: string;
  readonly authSecretFile: string;
  readonly sessionsDir: string;
}

/**
 * State lives under `$FREEBUFF_HOME`, else the XDG state directory. Tests point
 * `FREEBUFF_HOME` at a temporary directory, so nothing touches a real home dir.
 */
export const resolveCliPaths = (
  env: NodeJS.ProcessEnv = process.env,
): CliPaths => {
  const root =
    env.FREEBUFF_HOME ??
    join(env.XDG_STATE_HOME ?? join(env.HOME ?? homedir(), ".local", "state"), "freebuff");
  return {
    root,
    configFile: join(root, "config.json"),
    credentialsFile: join(root, "credentials.json"),
    stateFile: join(root, "platform-state.json"),
    authSecretFile: join(root, "auth-secret"),
    sessionsDir: join(root, "sessions"),
  };
};
