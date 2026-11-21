/**
 * The name of the cookie holding the Supabase session.
 *
 * WHY THIS EXISTS
 * ---------------
 * supabase-js derives the auth storage key from whatever URL the client was
 * built with:
 *
 *     `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
 *
 * The browser client (src/lib/supabase.ts) deliberately talks to Supabase
 * through a same-origin proxy (`<origin>/api/supabase`) to get around ISP
 * routing problems in Iraq, while the server client must use the real Supabase
 * URL. That made the two sides derive DIFFERENT cookie names — the browser
 * wrote `sb-<vercel-app-name>-auth-token`, the server looked for
 * `sb-<project-ref>-auth-token` — so the server never saw a session and every
 * Server Action failed with "no active session", even though the user was
 * plainly logged in.
 *
 * Pinning the name on both clients keeps them in agreement no matter which URL
 * each one points at. It is derived from the real project URL so it matches
 * Supabase's own default, and so different environments (prod / preview /
 * local) keep their own distinct cookie.
 */
function deriveAuthCookieName(): string {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (url) {
        try {
            const ref = new URL(url).hostname.split(".")[0];
            if (ref) return `sb-${ref}-auth-token`;
        } catch {
            // Malformed URL — fall through to the stable fallback below.
        }
    }
    // Must still be a fixed, shared value: both clients have to agree even when
    // the env var is missing, otherwise we are back to the bug above.
    return "sb-workshop-auth-token";
}

export const AUTH_COOKIE_NAME = deriveAuthCookieName();
