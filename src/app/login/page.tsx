"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { KeyRound, User, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const cleanUsername = username.trim().toLowerCase();
        const formattedEmail = cleanUsername.includes("@") ? cleanUsername : `${cleanUsername}@workshop.local`;

        const { error } = await supabase.auth.signInWithPassword({
            email: formattedEmail,
            password,
        });

        if (error) {
            // Only credential failures should blame the credentials — anything else
            // (network down, server unreachable) gets its own message.
            const isBadCredentials = error.message?.includes('Invalid login credentials') || error.status === 400;
            setError(isBadCredentials
                ? "اسم المستخدم أو كلمة المرور غير صحيحة"
                : "تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مجدداً");
            setLoading(false);
        } else {
            router.push("/dashboard");
            router.refresh();
        }
    };

    return (
        <div className="w-full flex flex-col items-center justify-center min-h-[80vh] font-ibm animate-fade-in" dir="rtl">
            <div className="glass-card p-8 md:p-12 rounded-3xl w-full max-w-md shadow-2xl relative overflow-hidden">
                {/* Background glows */}
                <div className="absolute -top-10 -right-10 w-48 h-48 bg-rose-500/20 blur-[60px] rounded-full pointer-events-none" />
                <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-blue-500/10 blur-[60px] rounded-full pointer-events-none" />

                <div className="relative z-10 flex flex-col items-center">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-border shadow-xl flex items-center justify-center p-2 mb-6 animate-slide-up delay-100">
                        <Image src="/logo.png" alt="Logo" width={64} height={64} className="object-contain" />
                    </div>

                    <h1 className="text-3xl font-display font-bold text-foreground mb-2 animate-slide-up delay-200">
                        دخول النظام
                    </h1>
                    <p className="text-muted-foreground font-medium mb-8 text-sm animate-slide-up delay-300">نظام إدارة هندسة السيارات</p>

                    <form onSubmit={handleLogin} className="w-full space-y-5 animate-slide-up delay-400">
                        {error && (
                            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 p-3 rounded-xl text-sm flex items-center gap-2">
                                <AlertCircle size={18} />
                                {error}
                            </div>
                        )}

                        <div className="space-y-2 relative">
                            <label className="text-sm font-medium text-muted-foreground ml-1">اسم المستخدم</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="مثال: abbas"
                                    className="input-field text-left"
                                    style={{ paddingLeft: '2.5rem' }}
                                    dir="ltr"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2 relative">
                            <label className="text-sm font-medium text-muted-foreground ml-1">كلمة المرور</label>
                            <div className="relative">
                                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="input-field text-left font-mono tracking-widest"
                                    style={{ paddingLeft: '2.5rem' }}
                                    dir="ltr"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-4 py-3 rounded-xl bg-gradient-to-l from-rose-600 to-rose-500 text-white font-bold hover:shadow-[0_0_20px_rgba(225,29,72,0.4)] transition-all flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin" size={20} />
                                    جاري الدخول...
                                </>
                            ) : (
                                "تسجيل الدخول"
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
