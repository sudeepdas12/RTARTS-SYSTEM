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
        retry: 1,
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
