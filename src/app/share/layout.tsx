import type { Metadata } from "next";

// A contract's private view link: never index it.
export const metadata: Metadata = {
    title: "أوراق العمل",
    robots: { index: false, follow: false },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
    return children;
}
