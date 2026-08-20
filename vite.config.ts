import { defineConfig, loadEnv, type PluginOption, type UserConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const nitroPreset = process.env.NITRO_PRESET || "cloudflare-module";

  const plugins: PluginOption[] = [];

  if (mode === "development") {
    plugins.push(
      devtools({
        logging: false,
        eventBusConfig: { enabled: false },
        enhancedLogs: { enabled: false },
        consolePiping: { enabled: false },
        removeDevtoolsOnBuild: false,
        injectSource: { enabled: true },
      }),
    );
  }

  plugins.push(
    tailwindcss(),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
      server: { entry: "server" },
    }),
    react(),
  );

  plugins.push(
    nitro({
      defaultPreset: nitroPreset,
    }),
  );

  // Inject VITE_* env vars as import.meta.env.* at build time.
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const config: UserConfig = {
    define: envDefine,
    css: {
      transformer: "lightningcss",
    },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      tsconfigPaths: true,
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins,
    server: {
      host: "::",
      port: 8080,
    },
  };

  if (isDev) {
    config.environments = {
      ...(config.environments || {}),
      client: {
        ...(config.environments?.client || {}),
        define: {
          ...(config.environments?.client?.define || {}),
          "process.env.NODE_ENV": JSON.stringify("development"),
        },
      },
    };
    config.esbuild = { keepNames: true } as unknown as typeof config.esbuild;
  }

  return config;
});
