import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Receives `code` from the designflow.app WeChat bounce, exchanges it via the
 * wechat-auth function, then continues into the normal Supabase session.
 */
export default function WeChatCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Signing in with WeChat…");

  useEffect(() => {
    const code = params.get("code");
    const error = params.get("error");
    if (error) {
      setMessage(`WeChat sign-in failed: ${error}`);
      return;
    }
    if (!code) {
      setMessage("Missing WeChat authorization code.");
      return;
    }

    let cancelled = false;

    (async () => {
      const readFnError = async (fnError: unknown): Promise<string> => {
        const err = fnError as {
          message?: string;
          context?: Response;
        };
        try {
          if (err?.context && typeof err.context.json === "function") {
            const body = await err.context.json();
            if (body?.error) return String(body.error);
          }
        } catch {
          // fall through to the generic message
        }
        return err?.message || "WeChat sign-in failed.";
      };

      try {
        const { data, error: fnError } = await supabase.functions.invoke("wechat-auth", {
          body: { code },
        });
        if (cancelled) return;
        if (fnError) {
          setMessage(await readFnError(fnError));
          return;
        }
        if (data?.access_token && data?.refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          });
          if (sessionError) throw sessionError;
          navigate("/", { replace: true });
          return;
        }
        setMessage(data?.error || "WeChat sign-in did not return a session.");
      } catch (err) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : "WeChat sign-in failed.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
