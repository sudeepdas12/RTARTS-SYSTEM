import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function ModuleStub({
  title,
  description,
  phase,
  children,
}: {
  title: string;
  description: string;
  phase: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Construction className="h-10 w-10 text-accent" />
          <h3 className="text-lg font-semibold">Coming in {phase}</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            The database, roles, and access policies are already provisioned for this module. The
            UI ships in the next phase.
          </p>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
