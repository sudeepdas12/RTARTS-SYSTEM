import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { toast } from "sonner";

export const getRouter = () => {
  const queryClient = new QueryClient({
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
