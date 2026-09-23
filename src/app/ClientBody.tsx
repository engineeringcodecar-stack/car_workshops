"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { AuthProvider } from "@/lib/AuthProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { CurrencyProvider } from "@/lib/CurrencyProvider";
import { usePathname } from "next/navigation";
import GlobalRealtimeProvider from "@/components/GlobalRealtimeProvider";
import AssistantWidget from "@/components/AssistantWidget";

export default function ClientBody({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isLoginPage = pathname === "/login";
    // Print/report views render on a clean white shell — no sidebar, no app chrome.
    const isPrintPage = pathname.startsWith("/print/") || pathname.startsWith("/inspection/") || pathname.startsWith("/sticker/");

    useEffect(() => {
        document.body.className = "antialiased";
    }, []);

    // Print pages: completely clean white shell — no sidebar, no dark mode, no providers
    if (isPrintPage) {
        return (
            <div style={{ background: "white", minHeight: "100vh" }}>
                {children}
            </div>
        );
    }

    const isPublicBookletPage = pathname.startsWith("/b/");
    if (isPublicBookletPage) {
        return (
            <LanguageProvider>
                <CurrencyProvider>
                    <div className="min-h-screen bg-[#08080d] text-foreground font-ibm">
                        {children}
                    </div>
                </CurrencyProvider>
            </LanguageProvider>
        );
    }

    return (
        <LanguageProvider>
            <CurrencyProvider>
                <AuthProvider>
                    <GlobalRealtimeProvider>
                        <div className={`min-h-screen pattern-bg font-ibm text-foreground print:bg-white print:text-black ${isLoginPage ? "flex flex-col items-center justify-center p-4 bg-background" : ""}`}>
                            {!isLoginPage && <Sidebar />}
                            <main className={isLoginPage ? "w-full max-w-md" : "min-h-screen transition-all duration-300 lg:pr-64 pt-16 lg:pt-0 print:pr-0 print:pt-0"}>
                                {children}
                            </main>
                            {!isLoginPage && <AssistantWidget />}
                        </div>
                    </GlobalRealtimeProvider>
                </AuthProvider>
            </CurrencyProvider>
        </LanguageProvider>
    );
}
