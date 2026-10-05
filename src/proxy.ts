import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that must remain reachable without an authenticated session.
// NOTE: `/b/` is the public, customer-facing vehicle booklet (opened via QR code).
// `/share/` is a contract's private read-only link (token in the URL, data via a
// security-definer function — see supabase/migrations/20261005_contract_share_link.sql).
const PUBLIC_PREFIXES = ["/login", "/b/", "/share/", "/api/"];

function isPublicPath(pathname: string): boolean {
    return PUBLIC_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(prefix)
    );
}

/**
 * Coarse, defense-in-depth auth gate. If no Supabase auth cookie is present, the
 * request is redirected to /login before any protected page renders.
 *
 * This deliberately does NOT validate the token (that would add an auth-server
 * round trip to every navigation). The real security boundary is Supabase RLS
 * plus the per-action `requireAdmin()` checks — this just stops anonymous users
 * from loading the app shell. See node_modules/next/.../proxy.md (line ~213):
 * authorization must still be enforced inside each Server Function.
 */
export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (isPublicPath(pathname)) {
        return NextResponse.next();
    }

    const hasSupabaseSession = request.cookies
        .getAll()
        .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

    if (!hasSupabaseSession) {
        const loginUrl = new URL("/login", request.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    // Run on every path except Next internals, the favicon and static assets.
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|pdf)$).*)",
    ],
};
