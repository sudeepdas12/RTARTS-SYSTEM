import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/tax-reports")({
  beforeLoad: () => {
    throw redirect({ to: "/reports" });
  },
  component: () => null,
});
