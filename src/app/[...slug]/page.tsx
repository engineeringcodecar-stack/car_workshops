import { Hammer, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "قريباً | النظام قيد التطوير",
};

export default async function MockModulePage({ params }: { params: Promise<{ slug: string[] }> }) {
    const resolvedParams = await params;
    // Generate a readable module name from the slug if needed, or just standard text
    const modulePath = resolvedParams.slug?.join(" / ") || "هذا القسم";
    
    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="w-24 h-24 bg-rose-500/10 rounded-3xl mx-auto flex items-center justify-center border border-rose-500/20 shadow-2xl shadow-rose-900/20 relative">
                    <div className="absolute inset-0 bg-rose-500/20 blur-xl rounded-full" />
                    <Hammer className="text-rose-500 relative z-10 animate-bounce" size={48} />
                </div>
                
                <div className="space-y-2">
                    <h1 className="text-2xl font-bold text-foreground font-display">
                        نظام الإدارة قيد التطوير
                    </h1>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        هذه الصفحة <span className="text-rose-400">({modulePath})</span> تحت الإنشاء سيتم ربطها قريباً بالنظام الشامل لـ Auto Workshop ERP. نشكر تفهمكم!
                    </p>
                </div>

                <div className="pt-8">
                    <Link 
                        href="/dashboard" 
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-border text-foreground rounded-xl transition-all font-medium text-sm group"
                    >
                        العودة إلى لوحة التحكم
                        <ArrowRight className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
