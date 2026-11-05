import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { toast } from "sonner";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 minute fresh cache for instant page switches
        gcTime: 10 * 60_000, // 10 minutes cache retention
        refetchOnWindowFocus: false, // Prevent aggressive background refetches
        retry: (failureCount, error: any) => {
          // Do not retry client-side errors (4xx), auth/permission errors, or schema/enum rejections
          const status = error?.status ?? error?.statusCode;
          if (typeof status === "number" && status >= 400 && status < 500) {
            return false;
          }
          // PostgREST / Postgres permission (42501), constraint (23505), or syntax/data type (22P02) errors
          if (
            error?.code &&
            typeof error.code === "string" &&
            (error.code.startsWith("42") ||
              error.code.startsWith("22") ||
              error.code.startsWith("23") ||
              error.code === "PGRST116")
          ) {
            return false;
          }
          return failureCount < 1;
        },
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (typeof document !== "undefined") {
          toast.error(`Error: ${error.message}`);
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (typeof document !== "undefined") {
          toast.error(`Error: ${error.message}`);
        }
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
