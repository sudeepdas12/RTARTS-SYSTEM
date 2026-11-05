import { Link, useRouterState } from "@tanstack/react-router";
import { UserCog, Settings, Calendar, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  description: string;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    title: "Users & Roles",
    url: "/users",
    icon: UserCog,
    description: "Accounts, RBAC roles & permissions",
  },
  {
    title: "System Settings",
    url: "/settings",
    icon: Settings,
    description: "Taxes, gateways & preferences",
  },
  {
    title: "Fiscal Years",
    url: "/settings/fiscal-years",
    icon: Calendar,
    description: "Accounting periods & date boundaries",
  },
  {
    title: "Backup & Recovery",
    url: "/backup",
    icon: HardDrive,
    description: "Snapshots, exports & disaster recovery",
  },
];

export function AdministrationSubNav({ className }: { className?: string }) {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 p-1 bg-muted/60 dark:bg-muted/30 rounded-lg border border-border/70 overflow-x-auto",
        className,
      )}
    >
      {ADMIN_NAV_ITEMS.map((item) => {
        const isActive =
          item.url === "/settings" ? currentPath === "/settings" : currentPath.startsWith(item.url);
        const Icon = item.icon;

        return (
          <Link
            key={item.url}
            to={item.url}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all shrink-0",
              isActive
                ? "bg-background text-foreground shadow-xs font-semibold border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          >
            <Icon
              className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-muted-foreground")}
            />
            <span>{item.title}</span>
          </Link>
        );
      })}
    </div>
  );
}
