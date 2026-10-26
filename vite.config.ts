import { defineConfig, loadEnv, type PluginOption, type UserConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const nitroPreset = process.env.NITRO_PRESET || "cloudflare-module";

  const plugins: PluginOption[] = [];

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
        "@tanstack/react-query",
        "@tanstack/react-router",
        "lucide-react",
        "date-fns",
        "xlsx",
        "sonner",
        "tailwind-merge",
        "clsx",
      ],
    },
    plugins,
    server: {
      host: "::",
      port: 8080,
      watch: {
        ignored: [
          "**/node_modules_old/**",
          "**/node_modules/**",
          "**/.git/**",
          "**/backups/**",
          "**/.output/**",
          "**/test-results/**",
        ],
      },
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
  }

  return config;
});
