"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthProvider";
import { Sparkles, Loader2, Send, User, Bot, X } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
    "شكد بعنا اليوم؟",
    "إيرادات هذا الشهر",
    "أكثر 5 منتجات مبيعاً",
    "منو أكثر فني هذا الشهر؟",
];

/**
 * فقاعة المساعد الذكي العائمة — تظهر بكل الصفحات للمالك/المدير فقط.
 * تعيد استخدام مسار /api/assistant نفسه (بلا أي تغيير بالخلفية).
 */
export default function AssistantWidget() {
    const { employeeRole } = useAuth();
    const pathname = usePathname();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";

    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, sending, open]);

    // لا تظهر بصفحات الدخول/الطباعة/الكتيّب العام.
    const hidden =
        pathname === "/login" ||
        pathname.startsWith("/print/") ||
        pathname.startsWith("/inspection/") ||
        pathname.startsWith("/sticker/") ||
        pathname.startsWith("/b/");

    if (!isAdmin || hidden) return null;

    const send = async (text: string) => {
        const q = text.trim();
        if (!q || sending) return;
        setError(null);
        const next = [...messages, { role: "user" as const, content: q }];
        setMessages(next);
        setInput("");
        setSending(true);
        try {
            const res = await fetch("/api/assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: next }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data?.error || "حدث خطأ.");
            } else {
                setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
            }
        } catch {
            setError("تعذّر الاتصال بالخادم.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div dir="rtl" className="font-ibm">
            {/* لوحة الشات */}
            {open && (
                <div className="fixed bottom-24 left-4 z-[60] w-[calc(100vw-2rem)] sm:w-[24rem] h-[70vh] max-h-[34rem] flex flex-col glass-card border border-rose-500/25 rounded-3xl shadow-2xl shadow-black/40 overflow-hidden">
                    {/* الرأس */}
                    <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-rose-600/10">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center">
                                <Sparkles size={18} />
                            </div>
                            <div className="leading-tight">
                                <p className="text-sm font-bold text-foreground">المساعد الذكي</p>
                                <p className="text-[11px] text-muted-foreground">اسأل عن أي بيانات بالورشة</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setOpen(false)}
                            aria-label="إغلاق"
                            className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card flex items-center justify-center transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* الرسائل */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center gap-4 text-muted-foreground px-2">
                                <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center">
                                    <Sparkles size={28} />
                                </div>
                                <p className="text-sm">اسألني أي شي عن أرقام الورشة</p>
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {SUGGESTIONS.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => send(s)}
                                            className="px-3 py-1.5 text-xs bg-card border border-border rounded-lg hover:border-rose-500/40 hover:text-foreground transition-colors"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((m, i) => (
                            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${m.role === "user" ? "bg-rose-500/10 text-rose-400" : "bg-blue-500/10 text-blue-400"}`}>
                                    {m.role === "user" ? <User size={15} /> : <Bot size={15} />}
                                </div>
                                <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-rose-600 text-white" : "glass-card border border-border text-foreground"}`}>
                                    {m.content}
                                </div>
                            </div>
                        ))}

                        {sending && (
                            <div className="flex gap-2">
                                <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0"><Bot size={15} /></div>
                                <div className="glass-card border border-border rounded-2xl px-3 py-2 flex items-center gap-2 text-muted-foreground text-xs">
                                    <Loader2 className="animate-spin w-3.5 h-3.5" /> يفكّر ويبحث بالبيانات...
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-3 text-rose-200 text-xs">{error}</div>
                        )}
                    </div>

                    {/* الكتابة */}
                    <form
                        onSubmit={(e) => { e.preventDefault(); send(input); }}
                        className="shrink-0 m-2 flex items-end gap-2 bg-card border border-border rounded-2xl p-1.5"
                    >
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                            placeholder="اكتب سؤالك هنا..."
                            rows={1}
                            className="flex-1 bg-transparent resize-none outline-none text-foreground placeholder:text-muted-foreground px-2 py-1.5 max-h-32 text-[13px]"
                        />
                        <button
                            type="submit"
                            disabled={sending || !input.trim()}
                            className="w-9 h-9 rounded-xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                        >
                            {sending ? <Loader2 className="animate-spin w-4 h-4" /> : <Send size={16} />}
                        </button>
                    </form>
                </div>
            )}

            {/* الفقاعة العائمة */}
            <button
                onClick={() => setOpen((v) => !v)}
                aria-label="المساعد الذكي"
                className="fixed bottom-5 left-5 z-[60] w-14 h-14 rounded-full bg-gradient-to-br from-rose-500 via-red-500 to-rose-700 text-white shadow-lg shadow-rose-900/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            >
                {open ? <X size={24} /> : <Sparkles size={24} />}
            </button>
        </div>
    );
}
