/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import type { AppProps } from "./App";

export type LaunchProps = Omit<AppProps, "onQuit">;

export const launchInteractive = async (props: LaunchProps): Promise<void> => {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 0, staleTime: 10_000 } },
  });
  const root = createRoot(renderer);

  const quit = (): void => {
    try {
      root.unmount();
    } finally {
      renderer.destroy();
    }
    process.exit(0);
  };

  root.render(
    <QueryClientProvider client={queryClient}>
      <App {...props} onQuit={quit} />
    </QueryClientProvider>,
  );
};
