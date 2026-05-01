import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeText, getContactViolation } from "@/lib/validation";
import EmptyState from "@/components/shared/EmptyState";
import { Search, Send, ArrowLeft, MessageCircle, Lock, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";

/**
 * Messages page — real DB-backed chat list.
 * Lists conversations the current user is part of (sender or receiver).
 * Privacy: RLS already restricts SELECT to messages where the user is sender or receiver.
 */
export default function Messages() {
  useSEO({ title: "الرسائل", description: "محادثاتك مع السائقين والركاب" });

  const qc = useQueryClient();
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [newConv, setNewConv] = useState(null); // { email, name } for a not-yet-created conversation
  const messagesEndRef = useRef(null);

  // Current user — from AuthContext (instant, no hang)
  const { user } = useAuth();

  // Fetch all messages where user is sender or receiver (parallel for speed)
  const { data: rawMessages = [], isLoading } = useQuery({
    queryKey: ["messages", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      // Use Supabase directly — bypasses base44 created_by filtering
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_email.eq.${user.email},receiver_email.eq.${user.email}`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) { console.warn("Messages fetch error:", error); return []; }
      return data || [];
    },
    enabled: !!user?.email,
    refetchInterval: false,
    staleTime: 3000,
  });

  // Fetch user's bookings to determine conversation status
  const { data: myBookings = [] } = useQuery({
    queryKey: ["my-bookings-msgs", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const [asPassenger, asDriver] = await Promise.all([
        base44.entities.Booking.filter({ passenger_email: user.email }, "-created_date", 100),
        base44.entities.Trip.filter({ created_by: user.email }, "-created_date", 100),
      ]);
      return { asPassenger, driverTrips: asDriver };
    },
    enabled: !!user?.email,
    staleTime: 30000,
  });

  // Determine if a conversation with otherEmail is closed (trip completed/cancelled)
  const getConvStatus = (otherEmail) => {
    if (!myBookings?.asPassenger) return "active";
    const { asPassenger = [], driverTrips = [] } = myBookings;

    // Check as passenger: did I book a trip driven by otherEmail?
    const asPassengerMatch = asPassenger.find(b =>
      b.passenger_email === user?.email &&
      (b.driver_email === otherEmail || b.created_by === otherEmail)
    );
    if (asPassengerMatch) {
      if (["completed"].includes(asPassengerMatch.status)) return "completed";
      if (["cancelled"].includes(asPassengerMatch.status)) return "cancelled";
      return "active";
    }

    // Check as driver: does otherEmail have a booking on my trips?
    const myTrip = driverTrips.find(t =>
      ["completed", "cancelled"].includes(t.status)
    );
    // Simple check: if any of my trips involving this person is done
    const driverMatch = asPassenger.find(b => b.passenger_email === otherEmail);
    if (myTrip && driverMatch) return myTrip.status;

    return "active";
  };

  // URL params — read here (no deps issue since we just read strings)
  const paramTo   = searchParams.get("to");
  const paramName = searchParams.get("name");

  // Realtime subscription — new/updated messages appear instantly
  React.useEffect(() => {
    if (!user?.email) return;
    const unsub = base44.entities.Message.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["messages", user.email] });
    });
    return () => unsub();
  }, [user?.email]);

  // Group messages by conversation_id (or fall back to "other person's email")
  const conversations = React.useMemo(() => {
    const groups = new Map();
    for (const msg of rawMessages) {
      const otherEmail = msg.sender_email === user?.email ? msg.receiver_email : msg.sender_email;
      const otherName  = msg.sender_email === user?.email ? msg.receiver_name : msg.sender_name;
      if (!otherEmail) continue;
      const key = msg.conversation_id || otherEmail;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          otherEmail,
          otherName: otherName || otherEmail.split("@")[0],
          messages: [],
          lastMessage: null,
          unreadCount: 0,
        });
      }
      const conv = groups.get(key);
      conv.messages.push(msg);
      if (!conv.lastMessage || new Date(msg.created_at) > new Date(conv.lastMessage.created_at)) {
        conv.lastMessage = msg;
      }
      if (msg.receiver_email === user?.email && !msg.is_read) {
        conv.unreadCount += 1;
      }
    }
    // Sort messages within each conversation oldest-to-newest for display
    for (const conv of groups.values()) {
      conv.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0)
    );
  }, [rawMessages, user?.email]);

  // Filter by search
  const filtered = search.trim()
    ? conversations.filter(c =>
        c.otherName?.toLowerCase().includes(search.toLowerCase()) ||
        c.otherEmail?.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  // activeConv: resolve from existing conversations OR from the pending newConv state
  const activeConv = React.useMemo(() => {
    if (activeId === "__new__" && newConv) {
      return { id: "__new__", otherEmail: newConv.email, otherName: newConv.name, messages: [], unreadCount: 0 };
    }
    return conversations.find(c => c.id === activeId) || null;
  }, [activeId, newConv, conversations]);

  // Auto-open conversation from URL params — runs AFTER conversations is defined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!paramTo || !user?.email) return;
    if (paramTo === user.email) return;
    const existing = conversations.find(c => c.otherEmail === paramTo);
    if (existing) {
      setActiveId(existing.id);
      setNewConv(null);
    } else {
      setNewConv({ email: paramTo, name: decodeURIComponent(paramName || paramTo.split("@")[0]) });
      setActiveId("__new__");
    }
  }, [paramTo, user?.email, conversations.length]);

  // Auto-scroll to bottom when conversation changes or new message arrives
  useEffect(() => {
    if (activeConv) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, activeConv?.messages?.length]);

  // Mark messages as read when opening a conversation
  useEffect(() => {
    if (!activeConv || !user?.email) return;
    const unread = activeConv.messages.filter(
      m => m.receiver_email === user.email && !m.is_read
    );
    if (unread.length === 0) return;
    Promise.all(unread.map(m => supabase.from("messages").update({ is_read: true }).eq("id", m.id)))
      .then(() => {
        // Invalidate the messages cache AND both badge caches so counts update immediately
        qc.invalidateQueries({ queryKey: ["messages", user.email] });
        qc.invalidateQueries({ queryKey: ["unread-messages-count", user.email] });
        qc.invalidateQueries({ queryKey: ["mobile-msg-badge", user.email] });
      })
      .catch(() => {});
  }, [activeId, activeConv, user?.email, qc]);

  // Send message
  const send = useMutation({
    mutationFn: async () => {
      if (!draft.trim() || !activeConv || !user?.email) return;
      const cleaned = sanitizeText(draft).slice(0, 5000);
      // Block phone/contact sharing in chat
      const violation = getContactViolation(cleaned);
      if (violation) {
        toast.error(violation, { duration: 5000 });
        return;
      }
      // Generate a stable conversation_id for new conversations
      const convId = activeConv.id === "__new__"
        ? [user.email, activeConv.otherEmail].sort().join("__")
        : activeConv.id;
      const { error: msgErr } = await supabase.from("messages").insert({
        conversation_id: convId,
        sender_email:   user.email,
        sender_name:    user.full_name || user.full_name || user.email.split("@")[0],
        receiver_email: activeConv.otherEmail,
        receiver_name:  activeConv.otherName || activeConv.otherEmail.split("@")[0],
        content:        cleaned,
        is_read:        false,
        message_type:   "text",
        trip_id:        activeConv.tripId || null,
      });
      if (msgErr) {
        console.error("Message insert error:", msgErr);
        throw new Error(msgErr.message);
      }
      setDraft("");
      setNewConv(null);
      // Switch to real conversation after first message sent
      const newConvId = [user.email, activeConv.otherEmail].sort().join("__");
      setActiveId(newConvId);
      qc.invalidateQueries({ queryKey: ["messages", user?.email] });
    },
    onError: () => toast.error("تعذر إرسال الرسالة. حاول مجدداً"),
  });

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8" dir="rtl">
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
          <MessageCircle className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">الرسائل</h1>
        <p className="text-muted-foreground text-sm mt-1">محادثاتك مع السائقين والركاب</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-card rounded-2xl border border-border overflow-hidden" style={{ minHeight: "60vh" }}>
        {/* ── Sidebar: conversation list ── */}
        <div className={`md:col-span-1 border-l border-border ${activeConv ? "hidden md:block" : ""}`}>
          <div className="p-3 border-b border-border sticky top-0 bg-card">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ابحث في المحادثات..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-10 h-10 rounded-xl"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">جاري التحميل...</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              emoji="💬"
              title={search ? "لا توجد نتائج" : "لا توجد محادثات بعد"}
              description={search ? "جرب اسماً آخر" : "ستظهر محادثاتك مع السائقين والركاب هنا بعد الحجز"}
            />
          ) : (
            <div>
              {filtered.map(conv => {
                const last = conv.lastMessage;
                const isMe = last?.sender_email === user?.email;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setActiveId(conv.id)}
                    className={`w-full text-right px-4 py-3 border-b border-border/40 hover:bg-muted/40 transition-colors ${activeId === conv.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                        {conv.otherName?.[0]?.toUpperCase() || "؟"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="font-medium text-sm text-foreground truncate">{conv.otherName}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {(() => {
                              const st = getConvStatus(conv.otherEmail);
                              if (st === "completed") return <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" />مكتملة</span>;
                              if (st === "cancelled") return <span className="text-[9px] bg-red-50 text-red-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" />ملغاة</span>;
                              return <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Circle className="w-2 h-2 fill-green-500" />نشطة</span>;
                            })()}
                            {last && <span className="text-[10px] text-muted-foreground">{formatTime(last.created_at)}</span>}
                          </div>
                        </div>
                        <p className={`text-xs truncate ${conv.unreadCount > 0 && !isMe ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                          {isMe && "أنت: "}{last?.content || ""}
                        </p>
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Active chat pane ── */}
        <div className={`md:col-span-2 flex flex-col ${activeConv ? "" : "hidden md:flex"}`}>
          {!activeConv ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
              <div className="text-center">
                <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">اختر محادثة لعرضها</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 sticky top-0 bg-card">
                <button onClick={() => setActiveId(null)} className="md:hidden p-1.5 rounded-lg hover:bg-muted">
                  <ArrowLeft className="w-4 h-4 rotate-180" />
                </button>
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  {activeConv.otherName?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/profile?email=${encodeURIComponent(activeConv.otherEmail)}`}
                        className="font-medium text-sm text-foreground hover:underline truncate block">
                    {activeConv.otherName}
                  </Link>
                  <p className="text-[10px] text-muted-foreground truncate">{activeConv.otherEmail}</p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20" style={{ maxHeight: "60vh" }}>
                {activeConv.messages.map(msg => {
                  const mine = msg.sender_email === user?.email;
                  return (
                    <div key={msg.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${mine ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer — locked if trip is completed/cancelled */}
              {(() => {
                const convStatus = getConvStatus(activeConv?.otherEmail);
                const isClosed = convStatus === "completed" || convStatus === "cancelled";
                if (isClosed) {
                  return (
                    <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Lock className="w-4 h-4 shrink-0" />
                      {convStatus === "completed"
                        ? "انتهت الرحلة — المحادثة مغلقة 🏁"
                        : "تم إلغاء الرحلة — المحادثة مغلقة"}
                    </div>
                  );
                }
                return (
                  <form
                    onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}
                    className="p-3 border-t border-border sticky bottom-0 bg-card"
                  >
                    {getContactViolation(draft) && (
                      <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-2 text-right">
                        {getContactViolation(draft)}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Input
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder="اكتب رسالة..."
                        className={`rounded-xl h-10 flex-1 ${getContactViolation(draft) ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        disabled={send.isPending}
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!draft.trim() || send.isPending || !!getContactViolation(draft)}
                        className="rounded-xl bg-primary text-primary-foreground"
                        aria-label="إرسال"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </form>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 24 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffH < 48) return "أمس";
  return d.toLocaleDateString("ar", { day: "numeric", month: "short" });
}
