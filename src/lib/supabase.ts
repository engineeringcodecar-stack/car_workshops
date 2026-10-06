import { createBrowserClient } from '@supabase/ssr'
import { processLock } from '@supabase/supabase-js'
import type { Database } from './types'
import { AUTH_COOKIE_NAME } from './supabase-cookie'

// Custom fetch wrapper to prevent infinite deadlocks when tabs hibernate/wake up.
// Supabase is known to freeze ALL requests if a token refresh gets deadlocked in the background.
const customFetch = (url: RequestInfo | URL, options?: RequestInit) => {
    // 1. We create our own strict 10s timeout promise
    // 2. We Race it against the actual Supabase fetch
    // 3. This physically guarantees no Supabase call can EVER freeze the app forever.
    const strictTimeout = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error("Supabase Network Freeze: 10s automatic timeout activated to break tab-sleep deadlock")), 10000);
    });

    return Promise.race([
        fetch(url, options),
        strictTimeout
    ]);
};

const getSupabaseUrl = () => {
    if (typeof window !== "undefined") {
        // Use relative path to proxy through Next.js server to bypass ISP blocks/routing issues in Iraq
        return `${window.location.origin}/api/supabase`;
    }
    return process.env.NEXT_PUBLIC_SUPABASE_URL!;
};

const getCustomWebSocket = () => {
    if (typeof window === "undefined") return undefined;
    return class extends WebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
            let targetUrl = url.toString();
            const realUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            if (realUrl) {
                const realOrigin = new URL(realUrl).origin;
                const wsOrigin = realOrigin.replace(/^http/, 'ws');
                const proxyPrefix = `${window.location.origin}/api/supabase`;
                const proxyWsPrefix = proxyPrefix.replace(/^http/, 'ws');
                if (targetUrl.startsWith(proxyWsPrefix)) {
                    targetUrl = targetUrl.replace(proxyWsPrefix, wsOrigin);
                }
            }
            super(targetUrl, protocols);
        }
    };
};

export const supabase = createBrowserClient<Database>(
    getSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
        // Pin the session cookie name. Without this it is derived from the proxy
        // URL above, which does NOT match what the server client derives from the
        // real Supabase URL — so no Server Action could ever see the session.
        cookieOptions: { name: AUTH_COOKIE_NAME },
        global: {
            fetch: customFetch
        },
        auth: {
            // Use an in-memory lock instead of the browser Web Locks API. The default
            // navigator lock throws "Lock ... was released because another request stole it"
            // under contention (slow networks, multiple tabs, or browsers like Brave),
            // which was crashing auth init for users. processLock serializes token
            // refreshes within the tab without relying on navigator.locks.
            lock: processLock,
        },
        realtime: {
            transport: getCustomWebSocket(),
        },
    }
);

// Every request waits on the auth lock while the session is being renewed. The library
// gives up after 5s by default, but on a slow connection a renewal alone can take up to
// customFetch's 10s, so every request queued behind it failed with "Acquiring process
// lock ... timed out" (seen at فرع القطاع: the role failed to load and staff got
// "غير مصرح بالوصول"). Wait up to 20s instead. Set on the instance because supabase-js's
// typed options don't list it, and passing it there changes the client's inferred types.
// GoTrueClient reads this field on every call.
(supabase.auth as unknown as { lockAcquireTimeout: number }).lockAcquireTimeout = 20000;
