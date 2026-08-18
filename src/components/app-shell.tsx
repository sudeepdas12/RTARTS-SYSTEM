import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Search, User, Bell, CheckCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/theme-toggle";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { NotificationService, NotificationRow } from "@/lib/services/notification.service";
import { ScrollArea } from "@/components/ui/scroll-area";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { open, setOpen } = useCommandPalette();

  const { data: notifications = [], refetch } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => NotificationService.getUnreadNotifications(user?.id || ""),
    enabled: !!user,
    refetchInterval: 60000, // Refresh every minute
  });

  const { mutate: markAllRead } = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      await NotificationService.markAllAsRead(user.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const { mutate: markRead } = useMutation({
    mutationFn: async (id: string) => {
      await NotificationService.markAsRead(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b glass px-4 transition-colors">
            <SidebarTrigger />
            <Breadcrumbs />
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="hidden gap-2 text-muted-foreground sm:inline-flex hover-lift"
              aria-label="Open command palette"
            >
              <Search className="h-4 w-4" />
              <span>Search…</span>
              <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline-block">
                {isMac ? "⌘" : "Ctrl"} K
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(true)}
              className="sm:hidden hover-lift"
              aria-label="Open search"
            >
              <Search className="h-4 w-4" />
            </Button>
            <ThemeToggle />

            {/* Notification Bell */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative hover-lift" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                  {notifications.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-0 glass-card">
                <DropdownMenuLabel className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-sm font-semibold">Notifications</span>
                  {notifications.length > 0 && (
                    <span className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => markAllRead()}>
                      <CheckCheck className="mr-1 inline h-3 w-3" />
                      Mark all read
                    </span>
                  )}
                </DropdownMenuLabel>
                <ScrollArea className="h-80">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center animate-fade-in">
                      <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">No new notifications</p>
                    </div>
                  ) : (
                    notifications.slice(0, 20).map((n: NotificationRow) => (
                      <DropdownMenuItem
                        key={n.id}
                        className="cursor-pointer items-start gap-2 border-b px-3 py-2.5 last:border-0 hover:bg-muted/50 transition-colors"
                        onClick={() => markRead(n.id)}
                      >
                        <div className="flex-1 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                             <p className="line-clamp-1 text-sm font-medium">{n.title}</p>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(n.created_at)}</span>
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                        </div>
                      </DropdownMenuItem>
                    ))
                  )}
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="hidden items-center gap-1 md:flex">
              {roles.map((r) => (
                <Badge key={r} variant="secondary" className="capitalize shadow-sm">
                  {r.replace("_", " ")}
                </Badge>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 hover-lift">
                  <User className="h-4 w-4" />
                  <span className="hidden max-w-[160px] truncate sm:inline">{user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-card">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} className="text-destructive focus:bg-destructive/10 cursor-pointer transition-colors">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main className="flex-1 p-6 overflow-auto animate-fade-in">{children}</main>
      </SidebarInset>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </SidebarProvider>
  );
}
