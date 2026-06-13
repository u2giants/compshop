import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ShoppingBag } from "lucide-react";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Auth() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
  if (user) return <Navigate to="/" replace />;

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast({ title: "Google sign-in failed", description: String(error), variant: "destructive" });
    }
  };

  const handleMicrosoftSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast({ title: "Microsoft sign-in failed", description: String(error), variant: "destructive" });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({ title: "Check your email", description: "We sent you a password reset link." });
      setIsForgot(false);
    } catch (err: unknown) {
      toast({ title: "Error", description: errorMessage(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        // Check if email is invited
        const { data: invited, error: checkErr } = await supabase.rpc("is_email_invited", { _email: email });
        if (checkErr) throw checkErr;
        if (!invited) {
          toast({
            title: "Invitation required",
            description: "You need an invitation from an admin to sign up. Contact your team admin.",
            variant: "destructive",
          });
          setSubmitting(false);
          return;
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName },
          },
        });
        if (error) throw error;
        toast({
          title: "Check your email",
          description: "We sent you a confirmation link to verify your account.",
        });
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: errorMessage(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShoppingBag className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-sans text-3xl font-semibold">CompShop</CardTitle>
          <CardDescription>
            {isForgot ? "Enter your email to receive a reset link" : isLogin ? "Sign in to your team account" : "Create your team account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isForgot ? (
            <>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>
              <div className="mt-4 text-center text-sm text-muted-foreground">
                <button
                  onClick={() => setIsForgot(false)}
                  className="font-medium text-primary hover:underline"
                >
                  Back to sign in
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Microsoft SSO */}
              <button
                type="button"
                onClick={handleMicrosoftSignIn}
                className="mb-2 flex w-full items-center gap-0 overflow-hidden rounded border border-[#8c8c8c] bg-[#2F2F2F] text-white transition-colors hover:bg-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#2F2F2F] focus:ring-offset-2"
              >
                <span className="flex h-11 w-12 shrink-0 items-center justify-center bg-white">
                  <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                  </svg>
                </span>
                <span className="flex-1 py-3 text-center text-sm font-semibold tracking-wide">
                  Continue with Microsoft
                </span>
              </button>

              {/* Google SSO */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="mb-4 flex w-full items-center gap-0 overflow-hidden rounded border border-[#dadce0] bg-white text-[#3c4043] transition-colors hover:bg-[#f8f9fa] hover:border-[#c6c9cd] focus:outline-none focus:ring-2 focus:ring-[#4285F4] focus:ring-offset-2"
              >
                <span className="flex h-11 w-12 shrink-0 items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
                  </svg>
                </span>
                <span className="flex-1 py-3 text-center text-sm font-semibold tracking-wide">
                  Continue with Google
                </span>
              </button>

              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      required={!isLogin}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {isLogin && (
                      <button
                        type="button"
                        onClick={() => setIsForgot(true)}
                        className="text-xs text-muted-foreground hover:text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}
                </Button>
              </form>

              {!isLogin && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Registration is invite-only. Ask your admin for an invitation.
                </p>
              )}

              <div className="mt-4 text-center text-sm text-muted-foreground">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-medium text-primary hover:underline"
                >
                  {isLogin ? "Sign up" : "Sign in"}
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
