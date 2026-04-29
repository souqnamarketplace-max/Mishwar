import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeText } from "@/lib/validation";
import EmptyState from "@/components/shared/EmptyState";
import { Search, Send, ArrowLeft, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

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
  const messagesEndRef = useRef(null);

  // Current user — from AuthContext (instant, no hang)
  const { user } = useAuth();

  // Fetch all messages where user is sender or receiver (parallel for speed)
  const { data: rawMessages = [], isLoading } = useQuery({
    queryKey: ["messages", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      // RLS ensures we only get our own messages
      const [sent, received] = await Promise.all([
        base44.entities.Message.filter({ sender_email: user.email }, "-created_date", 100),
        base44.entities.Message.filter({ receiver_email: user.email }, "-created_date", 100),
      ]);
      // Merge + dedupe by id
      const seen = new Set();
      const merged = [];
      for (const m of [...sent, ...received]) {
        if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
      }
      return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    enabled: !!user?.email,
    refetchInterval: 10000,  // refresh every 10s
    staleTime: 5000,
  });

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

  const activeConv = conversations.find(c => c.id === activeId);

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
    Promise.all(unread.map(m => base44.entities.Message.update(m.id, { is_read: true })))
      .then(() => qc.invalidateQueries({ queryKey: ["messages", user.email] }))
      .catch(() => {});
  }, [activeId, activeConv, user?.email, qc]);

  // Send message
  const send = useMutation({
    mutationFn: async () => {
      if (!draft.trim() || !activeConv || !user?.email) return;
      const cleaned = sanitizeText(draft).slice(0, 5000);
      await base44.entities.Message.create({
        conversation_id: activeConv.id,
        sender_email: user.email,
        sender_name: user.full_name,
        receiver_email: activeConv.otherEmail,
        receiver_name: activeConv.otherName,
        content: cleaned,
        is_read: false,
        message_type: "text",
      });
      setDraft("");
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
                          {last && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatTime(last.created_at)}
                            </span>
                          )}
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

              {/* Composer */}
              <form
                onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}
                className="p-3 border-t border-border flex items-center gap-2 sticky bottom-0 bg-card"
              >
                <Input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="اكتب رسالة..."
                  className="rounded-xl h-10 flex-1"
                  disabled={send.isPending}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim() || send.isPending}
                  className="rounded-xl bg-primary text-primary-foreground"
                  aria-label="إرسال"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
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
