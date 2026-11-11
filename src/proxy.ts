import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that must remain reachable without an authenticated session.
// NOTE: `/b/` is the public, customer-facing vehicle booklet (opened via QR code).
// `/share/` is a contract's private read-only link (token in the URL, data via a
// security-definer function — see supabase/migrations/20261005_contract_share_link.sql).
const PUBLIC_PREFIXES = ["/login", "/b/", "/share/", "/api/"];

// First segment of every page in the management system. A visitor without a session
// gets the login page for these and a plain 404 for anything else, so a mistyped
// address on the public site does not reveal the login page. A page missing from this
// list only loses the redirect: it still shows nothing without a session.
const APP_SECTIONS = new Set([
    "accounting", "alerts", "analytics", "assistant", "audit", "contracts", "customers",
    "dashboard", "documents", "employees", "financial-reports", "hr", "inspection",
    "inventory", "parts-db", "payroll", "print", "reception", "reports", "services",
    "settings", "status", "sticker", "suggestions", "technician-report", "warranty",
    "whatsapp", "work-orders",
]);

const NOT_FOUND_PAGE = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>الصفحة غير موجودة</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:14px;text-align:center;padding:24px;background:#08090B;color:#F5F5F4;font-family:system-ui,sans-serif}h1{margin:0;font-size:28px}p{margin:0;color:#A9ADB4}a{color:#E5444E}</style><h1>الصفحة غير موجودة</h1><p dir="ltr">Page not found</p><p><a href="/">الصفحة الرئيسية</a></p></html>`;

function isPublicPath(pathname: string): boolean {
    // `/en` is the English version of the public site and `/ar` serves the Arabic one
    // without the staff redirect that "/" has, so the language switch works signed in.
    return pathname === "/en" || pathname === "/ar" || PUBLIC_PREFIXES.some(
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

    // `/admin` is the address given to branch staff. The public site has no login link, so
    // they need one address that always leads into the system.
    if (pathname === "/admin" || pathname === "/admin/") {
        return NextResponse.redirect(new URL(hasSupabaseSession ? "/dashboard" : "/login", request.url));
    }

    // "/" is the public site for visitors; signed-in staff go straight to work.
    if (pathname === "/") {
        return hasSupabaseSession
            ? NextResponse.redirect(new URL("/dashboard", request.url))
            : NextResponse.next();
    }

    if (!hasSupabaseSession) {
        if (!APP_SECTIONS.has(pathname.split("/")[1])) {
            return new NextResponse(NOT_FOUND_PAGE, {
                status: 404,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }
        const loginUrl = new URL("/login", request.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    // Run on every path except Next internals, the favicon and static assets.
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|logo.png|robots.txt|sitemap.xml|site/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|pdf)$).*)",
    ],
};
