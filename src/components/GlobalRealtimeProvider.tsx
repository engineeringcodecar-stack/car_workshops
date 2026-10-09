"use client";

import React, { useEffect, useState, useRef, createContext, useContext } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { playNotificationSound } from "@/lib/sound";
import Swal from "sweetalert2";

export type NotificationItem = {
    id: string;
    title: string;
    text: string;
    time: Date;
    read: boolean;
    icon: string;
    color: string;
    bg: string;
};

const SVC_NAMES: Record<string, string> = {
    engineOil: "زيت المحرك",
    oilFilter: "فلتر زيت المحرك",
    airFilter: "فلتر الهواء",
    acFilter: "فلتر التبريد",
    brakeFluid: "زيت المكابح",
    coolant: "ماء الراديتر",
    battery: "البطارية",
    engineBelts: "قايش المحرك",
    brakePads: "دسكات السيارة",
    sparkPlugs: "شمعات الاحتراق",
    gearboxHydraulic: "هايدروليك الكير",
    gearboxFilter: "فلتر الكير",
    wipers: "الماسحات",
    additives: "المضافات والمحسنات",
    engineFlash: "فلاش محرك",
    engineCeramic: "سيراميك محرك",
    linerCleaner: "منظف بطانة (جكجكة)",
};

// What we remember about a work order so we can tell what changed on the next event.
// The realtime publication deliberately no longer ships the previous row (that cost the
// database the whole selected_services payload, old AND new, on every single update —
// it is what took the workshop offline), so the comparison happens here instead.
type OrderSnapshot = { status?: string; bay?: string | null; services?: any };

// Describe what changed inside a work order's services payload, or null if nothing
// worth announcing. Lifted out of the event handler unchanged so it can run against a
// row we fetched ourselves rather than against a replicated old record.
function describeServiceChange(oldServices: any, newServices: any):
    { kind: 'tech' } | { kind: 'detail'; message: string } | null {
    const oldArr = Array.isArray(oldServices) ? oldServices : [oldServices];
    const newArr = Array.isArray(newServices) ? newServices : [newServices];

    const oldTech = oldArr[0]?.technicianName;
    const newTech = newArr[0]?.technicianName;
    if (oldTech !== undefined && newTech && newTech !== oldTech) return { kind: 'tech' };

    if (newArr.length > oldArr.length) {
        const newlyAdded = newArr[newArr.length - 1];
        return newlyAdded?.name ? { kind: 'detail', message: `إضافة: ${newlyAdded.name}` } : null;
    }

    const old0 = oldArr[0] || {};
    const new0 = newArr[0] || {};
    if (!new0.is_paper_v2_format || !old0.is_paper_v2_format) return null;

    const oldCustom = old0.customServices || [];
    const newCustom = new0.customServices || [];
    if (newCustom.length > oldCustom.length) {
        const newlyAdded = newCustom[newCustom.length - 1];
        return newlyAdded?.label ? { kind: 'detail', message: `إضافة عنصر: ${newlyAdded.label}` } : null;
    }

    const oldS = old0.services || {};
    const newS = new0.services || {};
    for (const key of Object.keys(newS)) {
        if (newS[key]?.status === 'تغيير' && oldS[key]?.status !== 'تغيير') {
            return { kind: 'detail', message: `تحديد تغيير: ${SVC_NAMES[key] || key}` };
        }
    }
    return null;
}

interface NotificationContextType {
    notifications: NotificationItem[];
    markAsRead: (id: string) => void;
    clearAll: () => void;
    unreadCount: number;
}

export const NotificationContext = createContext<NotificationContextType>({
    notifications: [],
    markAsRead: () => {},
    clearAll: () => {},
    unreadCount: 0
});

export const useNotifications = () => useContext(NotificationContext);

export default function GlobalRealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, employeeBranchId, employeeRole } = useAuth();
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    // Stored per user, so on a shared PC the next person never sees someone else's list.
    const storageKey = user ? `global_notifications:${user.id}` : null;
    const [loadedKey, setLoadedKey] = useState<string | null>(null);

    // Load from localStorage whenever the signed-in user changes
    useEffect(() => {
        let next: NotificationItem[] = [];
        try {
            localStorage.removeItem('global_notifications'); // old shared key
            const saved = storageKey ? localStorage.getItem(storageKey) : null;
            if (saved) {
                const parsed = JSON.parse(saved);
                // Convert string dates back to Date objects
                next = parsed.map((n: any) => ({ ...n, time: new Date(n.time) }));
            }
        } catch (e) {
            console.error('Failed to parse notifications from local storage', e);
        }
        setNotifications(next);
        setLoadedKey(storageKey);
    }, [storageKey]);

    // Save to localStorage when updated (only once this user's list is loaded)
    useEffect(() => {
        if (storageKey && loadedKey === storageKey) {
            try { localStorage.setItem(storageKey, JSON.stringify(notifications)); } catch {}
        }
    }, [notifications, storageKey, loadedKey]);

    const addNotification = (notif: Omit<NotificationItem, 'id' | 'time' | 'read'>) => {
        setNotifications(prev => [{
            ...notif,
            id: Math.random().toString(36).substring(2, 9),
            time: new Date(),
            read: false
        }, ...prev].slice(0, 50)); // Keep last 50
    };

    const markAsRead = (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const clearAll = () => {
        setNotifications([]);
    };

    // Last known state per work order, so an event can be compared against something
    // without the database shipping the previous row to every client.
    const snapshotsRef = useRef<Map<string, OrderSnapshot>>(new Map());
    // Orders whose payload we are already fetching, so a burst of edits on one order
    // cannot turn into a burst of queries.
    const inFlightRef = useRef<Set<string>>(new Set());

    // Seed the snapshots once per session with the newest orders (three slim columns),
    // so the very first event after a page load can still be interpreted.
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('inspection_reports')
                .select('id, status, bay_number')
                .order('created_at', { ascending: false })
                .limit(500);
            if (cancelled || !data) return;
            data.forEach((r: any) => {
                if (!snapshotsRef.current.has(r.id)) {
                    snapshotsRef.current.set(r.id, { status: r.status, bay: r.bay_number });
                }
            });
        })();
        return () => { cancelled = true; };
    }, [user]);

    // An edit that touched neither the status nor the bay happened inside the services
    // payload. Fetch that ONE row and diff it, rather than having every update replicate
    // the full payload to every connected client.
    const inspectServiceChange = async (id: string, reportNumber: number) => {
        if (inFlightRef.current.has(id)) return;
        inFlightRef.current.add(id);
        try {
            const { data } = await supabase
                .from('inspection_reports')
                .select('selected_services')
                .eq('id', id)
                .single();
            const newServices = data?.selected_services;
            const snap = snapshotsRef.current.get(id);
            const oldServices = snap?.services;
            if (snap) snapshotsRef.current.set(id, { ...snap, services: newServices });
            // Nothing to compare against yet — this pass only records the baseline.
            if (!oldServices || !newServices) return;

            const change = describeServiceChange(oldServices, newServices);
            if (!change) return;

            playNotificationSound();
            if (change.kind === 'tech') {
                const title = `تغيير الفني المسؤول 🔧`;
                const text = `تم تعيين فني جديد لأمر العمل #${reportNumber}`;
                addNotification({ title, text, icon: 'User', color: 'text-indigo-500', bg: 'bg-indigo-500/10' });
                Swal.fire({
                    title, text,
                    icon: 'info',
                    toast: true, position: 'top-end', showConfirmButton: false, timer: 4000, timerProgressBar: true, background: '#0f172a', color: '#8b5cf6'
                });
            } else {
                const title = `تعديل داخلي 🛠️`;
                const text = `في أمر #${reportNumber} - ${change.message}`;
                addNotification({ title, text, icon: 'Wrench', color: 'text-rose-500', bg: 'bg-rose-500/10' });
                Swal.fire({
                    title, text,
                    icon: 'info',
                    toast: true, position: 'top-end', showConfirmButton: false, timer: 5000, timerProgressBar: true, background: '#0f172a', color: '#f43f5e'
                });
            }
        } catch {
            // A failed lookup only costs one toast — never surface it.
        } finally {
            inFlightRef.current.delete(id);
        }
    };

    useEffect(() => {
        if (!user) return; // Only listen if authenticated

        const channel = supabase.channel('global_notifications')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, (payload) => {

                const newRecord = payload.new as any;
                const oldRecord = payload.old as any;

                // Branch filtering
                if (employeeRole !== 'Owner' && employeeRole !== 'Admin') {
                    if (newRecord?.branch_id && newRecord.branch_id !== employeeBranchId) {
                        return; // Ignore if it's not for this branch
                    }
                }

                // 1. New Work Order Created
                if (payload.eventType === 'INSERT') {
                    snapshotsRef.current.set(newRecord.id, { status: newRecord.status, bay: newRecord.bay_number });
                    if (newRecord.status === 'تم الاستلام') {
                        playNotificationSound();
                        const title = `أمر عمل جديد!`;
                        const text = `تم فتح أمر عمل جديد برقم ${newRecord.report_number}`;
                        addNotification({ title, text, icon: 'Clock', color: 'text-sky-400', bg: 'bg-sky-500/10' });
                        Swal.fire({
                            title,
                            text,
                            icon: 'info',
                            toast: true,
                            position: 'top-end',
                            showConfirmButton: false,
                            timer: 5000,
                            timerProgressBar: true,
                            background: '#0f172a',
                            color: '#38bdf8'
                        });
                    }
                }

                // 2. Status Updates
                if (payload.eventType === 'UPDATE') {
                    const id = newRecord?.id;
                    if (!id) return;
                    // The previous state comes from our own snapshot. The replicated old
                    // row is still honoured when present, so this keeps working either way.
                    const prev: OrderSnapshot | undefined = snapshotsRef.current.get(id)
                        || (oldRecord && oldRecord.status !== undefined
                            ? { status: oldRecord.status, bay: oldRecord.bay_number, services: oldRecord.selected_services }
                            : undefined);
                    snapshotsRef.current.set(id, {
                        status: newRecord.status,
                        bay: newRecord.bay_number,
                        services: prev?.services,
                    });

                    if (prev) {
                        let didAlert = false;

                        // Status Changed
                        if (prev.status !== undefined && newRecord.status !== prev.status) {
                            playNotificationSound();
                            didAlert = true;

                            if (prev.status === 'تم الانتهاء' && newRecord.status === 'قيد العمل') {
                                const title = `تمت إعادة فتح أمر العمل ⏳`;
                                const text = `تمت إعادة المركبة #${newRecord.report_number} إلى وضع قيد العمل`;
                                addNotification({ title, text, icon: 'RefreshCcw', color: 'text-amber-500', bg: 'bg-amber-500/10' });
                                Swal.fire({
                                    title, text,
                                    icon: 'warning',
                                    toast: true, position: 'top-end', showConfirmButton: false, timer: 5000, timerProgressBar: true, background: '#0f172a', color: '#f59e0b'
                                });
                            } else if (newRecord.status === 'قيد العمل') {
                                const title = `بدأ العمل 🛠️`;
                                const text = `أمر العمل #${newRecord.report_number} أصبح قيد العمل الآن`;
                                addNotification({ title, text, icon: 'Wrench', color: 'text-blue-500', bg: 'bg-blue-500/10' });
                                Swal.fire({
                                    title, text,
                                    icon: 'info',
                                    toast: true, position: 'top-end', showConfirmButton: false, timer: 5000, timerProgressBar: true, background: '#0f172a', color: '#3b82f6'
                                });
                            } else if (newRecord.status === 'تم الانتهاء') {
                                const title = `أمر صيانة جاهز للمحاسبة 💸`;
                                const text = `اكتمل العمل في أمر الصيانة #${newRecord.report_number} - يرجى المراجعة والتدقيق المالي.`;
                                addNotification({ title, text, icon: 'CheckCircle2', color: 'text-emerald-500', bg: 'bg-emerald-500/10' });
                                Swal.fire({
                                    title, text,
                                    icon: 'success',
                                    toast: true, position: 'top-end', showConfirmButton: false, timer: 7000, timerProgressBar: true, background: '#0f172a', color: '#10b981'
                                });
                            }
                        }

                        // Key Details Changed (only if status didn't just change, to avoid spam)
                        if (!didAlert) {
                            if (newRecord.bay_number !== prev.bay) {
                                playNotificationSound();
                                const title = `تحديث الخانة 🚗`;
                                const text = `تم نقل أمر العمل #${newRecord.report_number} إلى ${newRecord.bay_number || 'غير محدد'}`;
                                addNotification({ title, text, icon: 'Car', color: 'text-purple-500', bg: 'bg-purple-500/10' });
                                Swal.fire({
                                    title, text,
                                    icon: 'info', toast: true, position: 'top-end', showConfirmButton: false, timer: 4000, timerProgressBar: true, background: '#0f172a', color: '#8b5cf6'
                                });
                            } else {
                                // Neither status nor bay moved, so the edit is inside the
                                // services payload — go read that one row and diff it.
                                void inspectServiceChange(id, newRecord.report_number);
                            }
                        }
                    }
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, employeeBranchId, employeeRole]);

    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <NotificationContext.Provider value={{ notifications, markAsRead, clearAll, unreadCount }}>
            {children}
        </NotificationContext.Provider>
    );
}
