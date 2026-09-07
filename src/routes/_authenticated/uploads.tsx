import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/uploads")({
  beforeLoad: () => {
    throw redirect({ to: "/upload-history" });
  },
  component: () => null,
});
