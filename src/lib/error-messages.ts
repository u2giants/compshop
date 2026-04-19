/**
 * Translate technical error objects (AbortError, TypeError, fetch failures, etc.)
 * into short, human-readable messages suitable for toasts.
 *
 * Use this everywhere a raw `err.message` would otherwise be shown to the user —
 * particularly around camera capture, AI analysis, and uploads, where browsers
 * and Supabase Functions emit cryptic strings like
 * `"signal is aborted without reason"`.
 */
export function friendlyErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;

  // Standard DOMException / Error with a `name`
  const name = (err as { name?: string }).name;
  const rawMessage = (err as { message?: string }).message ?? "";
  const lower = rawMessage.toLowerCase();

  // AbortError — request was cancelled (tab backgrounded, navigation, double-tap, slow network)
  if (name === "AbortError" || lower.includes("aborted") || lower.includes("abort")) {
    return "Request was interrupted. This usually happens when the page reloads after using the camera, or on a slow connection. Please try again.";
  }

  // Network / offline
  if (name === "TypeError" && (lower.includes("failed to fetch") || lower.includes("network"))) {
    return "Network connection lost. Check your internet and try again.";
  }
  if (lower.includes("networkerror") || lower.includes("network request failed")) {
    return "Network connection lost. Check your internet and try again.";
  }

  // Timeout
  if (name === "TimeoutError" || lower.includes("timeout") || lower.includes("timed out")) {
    return "The request took too long. Please try again on a stronger connection.";
  }

  // Supabase function-specific
  if (lower.includes("rate limit")) {
    return "Too many requests right now. Please wait a moment and try again.";
  }
  if (lower.includes("payment required")) {
    return "AI quota exceeded. Please contact your admin.";
  }

  // Permission
  if (name === "NotAllowedError") {
    return "Permission denied. Please enable camera/file access in your browser settings.";
  }
  if (name === "NotFoundError") {
    return "Camera not found on this device.";
  }
  if (name === "NotReadableError") {
    return "Camera is already in use by another app. Close it and try again.";
  }

  // Fall back to the raw message if it looks human-readable, otherwise the generic fallback
  if (rawMessage && rawMessage.length < 200 && !lower.includes("typeerror")) {
    return rawMessage;
  }
  return fallback;
}
