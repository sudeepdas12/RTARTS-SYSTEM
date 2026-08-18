import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, MailCheck, ShieldCheck } from "lucide-react";

const searchSchema = z.object({
  mode: z.enum(["signin", "forgot"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  component: AuthPage,
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
type SignInValues = z.infer<typeof signInSchema>;

const forgotSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});
type ForgotValues = z.infer<typeof forgotSchema>;

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });
type PasswordValues = z.infer<typeof passwordSchema>;

type AuthView =
  | "loading"
  | "signin"
  | "forgot"
  | "reset"
  | "invite"
  | "confirmed";

function AuthPage() {
  const navigate = useNavigate();
  const { mode } = Route.useSearch();
  const [view, setView] = useState<AuthView>("loading");
  const [callbackEmail, setCallbackEmail] = useState<string | null>(null);

  const handleAuthCallback = useCallback(async () => {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const hashParams = new URLSearchParams(
      url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
    );

    const type =
      params.get("type") ??
      hashParams.get("type") ??
      hashParams.get("error_description");
    const tokenHash = params.get("token_hash") ?? hashParams.get("token_hash");
    const code = params.get("code");
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    const cleanUrl = () => window.history.replaceState({}, "", "/auth");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        toast.error(error.message);
        setView("signin");
        return;
      }
      cleanUrl();
      if (type === "recovery") return setView("reset");
      if (type === "invite") return setView("invite");
      if (type === "signup") return setView("confirmed");
      navigate({ to: "/dashboard", replace: true });
      return;
    }

    if (accessToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken ?? "",
      });
      if (error) {
        toast.error(error.message);
        setView("signin");
        return;
      }
      cleanUrl();
      if (type === "recovery") return setView("reset");
      navigate({ to: "/dashboard", replace: true });
      return;
    }

    if (type && tokenHash) {
      const validTypes = [
        "recovery",
        "invite",
        "magiclink",
        "email_change",
        "signup",
      ];
      const otpType = (validTypes.includes(type) ? type : "signup") as
        | "recovery"
        | "invite"
        | "magiclink"
        | "email_change"
        | "signup";

      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (error) {
        toast.error(error.message);
        setView("signin");
        return;
      }
      cleanUrl();
      if (type === "recovery") return setView("reset");
      if (type === "invite") return setView("invite");
      if (type === "email_change") return setView("confirmed");
      if (type === "signup") return setView("confirmed");
      navigate({ to: "/dashboard", replace: true });
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    setView(mode === "forgot" ? "forgot" : "signin");
  }, [mode, navigate]);

  useEffect(() => {
    void handleAuthCallback();
  }, [handleAuthCallback]);

    const handleSignInSuccess = useCallback((email: string) => {
    setCallbackEmail(email);
    setView("confirmed");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[oklch(0.22_0.045_255)] via-[oklch(0.28_0.05_255)] to-[oklch(0.32_0.09_255)] p-4">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mb-6 flex items-center justify-center gap-3 text-sm text-white/70 hover:text-white transition-colors"
        >
          <img
            src="/rbb-logo.jpg"
            alt="RBBMBL"
            className="h-20 w-20 rounded-xl object-contain shadow-lg ring-1 ring-white/20"
          />
          <div className="flex flex-col">
            <span className="text-xl font-bold text-white">RBBMBL</span>
            <span className="text-xs text-white/50">RTA / RTS Console</span>
          </div>
        </Link>
        <Card className="glass-card border-white/10">
          <CardHeader>
            <CardTitle className="text-xl">
              {view === "forgot" && "Reset your password"}
              {view === "reset" && "Choose a new password"}
              {view === "invite" && "Finish creating your account"}
              {view === "confirmed" && "Check your inbox"}
              {(view === "signin" || view === "loading") &&
                "Access your console"}
            </CardTitle>
            <CardDescription>
              {view === "forgot" &&
                "Enter the email tied to your account and we'll send you a reset link."}
              {view === "reset" &&
                "Your identity has been verified. Set a new password to continue."}
              {view === "invite" &&
                "You've been invited to the RBBMBL platform. Set a password to finish."}
              {view === "confirmed" &&
                "We sent you an email with a link. Open it to continue."}
              {(view === "signin" || view === "loading") &&
                "Manage debenture interest, dividends, and reconciliation."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {view === "loading" && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Checking your session…</p>
              </div>
            )}

            {view === "signin" && (
              <SignInForm
                onForgot={() => setView("forgot")}
                onEmailConfirmed={handleSignInSuccess}
              />
            )}

            {view === "forgot" && <ForgotForm onBack={() => setView("signin")} />}

            {view === "reset" && (
              <SetPasswordForm mode="reset" onDone={() => setView("signin")} />
            )}

            {view === "invite" && (
              <SetPasswordForm mode="invite" onDone={() => setView("signin")} />
            )}

            {view === "confirmed" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 px-4 py-8 text-center">
                  <MailCheck className="h-10 w-10 text-accent" />
                  <p className="text-sm text-muted-foreground">
                    {callbackEmail ? (
                      <>
                        A confirmation link has been sent to{" "}
                        <span className="font-medium text-foreground">
                          {callbackEmail}
                        </span>
                        .
                      </>
                    ) : (
                      "Your email has been confirmed. You can sign in now."
                    )}
                  </p>
                </div>
                <Button asChild className="w-full">
                  <Link to="/auth" search={{ mode: "signin" }}>
                    Back to sign in
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Accounts are provisioned by your system administrator.
                </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

function SignInForm({
  onForgot,
  onEmailConfirmed,
}: {
  onForgot: () => void;
  onEmailConfirmed: (email: string) => void;
}) {
  const navigate = useNavigate();
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    setSubmitting(false);

    if (error) {
      if (error.message.toLowerCase().includes("confirm")) {
        onEmailConfirmed(values.email);
        return;
      }
      toast.error(error.message, {
        description:
          "If you're sure the details are right, request a password reset.",
      });
      return;
    }

    toast.success("Welcome back");
    navigate({ to: "/dashboard", replace: true });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <button
                  type="button"
                  onClick={onForgot}
                  className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Form>
  );
}


// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

function ForgotForm({ onBack }: { onBack: () => void }) {
  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("Reset link sent");
  });

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 px-4 py-8 text-center">
          <MailCheck className="h-10 w-10 text-accent" />
          <p className="text-sm text-muted-foreground">
            If an account exists for that email, you’ll receive a password reset
            link shortly.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Sending link…" : "Send reset link"}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Set new password (recovery / invite)
// ---------------------------------------------------------------------------

function SetPasswordForm({
  mode,
  onDone,
}: {
  mode: "reset" | "invite";
  onDone: () => void;
}) {
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);

    const profileUpdate =
      mode === "invite" && name.trim()
        ? { data: { full_name: name.trim() } }
        : undefined;

    const { error } = await supabase.auth.updateUser({
      password: values.password,
      ...(profileUpdate ?? {}),
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      mode === "reset"
        ? "Password updated. You can sign in now."
        : "Account created. You can sign in now.",
    );

    if (mode === "invite" && name.trim()) {
      const { data: sessionData } = await supabase.auth.getUser();
      if (sessionData.user) {
        await supabase
          .from("profiles")
          .update({ full_name: name.trim() })
          .eq("id", sessionData.user.id);
      }
    }

    onDone();
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "invite" && (
          <div className="space-y-2">
            <label
              htmlFor="invite-name"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Full name
            </label>
            <Input
              id="invite-name"
              placeholder="Jane Doe"
              autoComplete="name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    className="pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FormControl>
              <FormDescription>At least 8 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting
            ? mode === "reset"
              ? "Updating password…"
              : "Creating account…"
            : mode === "reset"
              ? "Update password"
              : "Create account"}
        </Button>
      </form>
    </Form>
  );
}






