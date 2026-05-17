import { useSEO } from "@/hooks/useSEO";
import { useOnboardingGate } from "@/hooks/useOnboardingGate";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeText, getContactViolation } from "@/lib/validation";
import EmptyState from "@/components/shared/EmptyState";
import {
  Search, Send, ArrowLeft, MessageCircle, Lock,
  MapPin, ChevronLeft, Paperclip, ImageIcon, X, Camera, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import PassengerReviewWizard from "@/components/reviews/PassengerReviewWizard";
import { useBlockedEmails } from "@/lib/blockUtils";
import { isDeletedUserEmail } from "@/lib/userStatus";
import UserActionsMenu from "@/components/shared/UserActionsMenu";
import {
  compressImage, uploadAttachment, deleteAttachment,
  getCurrentLocation, buildMapsUrl,
} from "@/lib/chatAttachments";
import { createPortal } from "react-dom";

/**
 * Messages page — Poparide-style chat.
 * - Per-conversation trip context banner (green/amber/blue/grey/etc by booking status)
 * - Top status bar when trip is completed/cancelled/in-progress
 * - Message bubbles with avatars + date separators
 * - Quick-reply chips above input
 * - Locked composer when trip is completed/cancelled
 *
 * Privacy: RLS already restricts SELECT to messages where user is sender or receiver.
 */

/**
 * Returns quick reply chips appropriate for the user's role in this conversation.
 *
 * - "driver"   → I am the driver of this trip → reassure passenger I'm en route
 * - "approved" / "pending" → I am the passenger (booking confirmed or pending) →
 *                            tell driver I'm ready, on my way, etc.
 * - "none"     → No booking yet, likely an inquiry → ask common questions
 * - default    → small set of universal chips
 */
function getQuickReplies(bookingStatus) {
  if (bookingStatus === "driver") {
    return [
      "👍",
      "في الطريق إليك 🚗",
      "وصلت 📍",
      "تأخرت قليلاً ⏰",
      "لا أستطيع الكتابة، أنا أقود",
    ];
  }
  if (bookingStatus === "approved" || bookingStatus === "pending") {
    return [
      "👍",
      "أنا جاهز/ة 👋",
      "في الطريق 🚶",
      "وصلت لنقطة اللقاء 📍",
      "شكراً 🙏",
    ];
  }
  if (bookingStatus === "none") {
    return [
      "👍",
      "هل المقعد لا يزال متوفراً؟",
      "ما نقطة الالتقاء؟",
      "هل يمكن الدفع نقداً؟",
      "شكراً 🙏",
    ];
  }
  // Fallback — should rarely render since completed/cancelled chats are locked
  return ["👍", "شكراً 🙏"];
}

export default function Messages() {
  useSEO({ title: "الرسائل", description: "محادثاتك مع السائقين والركاب" });

  const qc = useQueryClient();
  const requireOnboarding = useOnboardingGate();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [newConv, setNewConv] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);
  const messagesEndRef = useRef(null);

  const { user } = useAuth();
  const paramTo      = searchParams.get("to");
  const paramName    = searchParams.get("name");
  const paramTrip    = searchParams.get("trip");
  const paramRequest = searchParams.get("request");

  // Track that the driver opened a conversation about a passenger trip
  // request — increments contact_count on the request (deduped server-
  // side via UNIQUE INDEX on trip_request_contacts). Fires once per
  // (driver, request) regardless of how many times they reopen.
  // We only call this when a request param exists AND the current user
  // is the contacting party (not the passenger receiving), to avoid
  // self-tracking when the passenger views their own conversation.
  //
  // IMPORTANT: supabase.rpc() returns a PostgrestFilterBuilder, which
  // is thenable but NOT a Promise — chaining .catch() directly on it
  // throws `TypeError: ...catch is not a function` synchronously inside
  // this effect, which in React 18 bubbles through the commit phase to
  // the nearest ErrorBoundary and shows فشل تحميل هذه الصفحة. The fix
  // is to await it inside an async IIFE so the rejection (if any) is
  // caught by a real try/catch. The RPC also returns errors via the
  // destructured { error } shape rather than throwing — the try/catch
  // here is really just defending against unexpected programming errors.
  React.useEffect(() => {
    if (!paramRequest || !paramTo || !user?.email) return;
    if (paramTo === user.email) return; // passenger viewing their own conv
    (async () => {
      try {
        await supabase.rpc("track_request_contact", { p_request_id: paramRequest });
      } catch { /* non-fatal — analytics only */ }
    })();
  }, [paramRequest, paramTo, user?.email]);

  // ─── Fetch all messages where user is sender or receiver ───
  const { data: rawMessages = [], isLoading } = useQuery({
    queryKey: ["messages", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
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

  // ─── Fetch user's bookings (for booking-status determination) ───
  const { data: myBookings = { asPassenger: [], driverTrips: [] } } = useQuery({
    queryKey: ["my-bookings-msgs", user?.email],
    queryFn: async () => {
      if (!user?.email) return { asPassenger: [], driverTrips: [] };
      const [asPassenger, driverTrips] = await Promise.all([
        api.entities.Booking.filter({ passenger_email: user.email }, "-created_date", 100),
        api.entities.Trip.filter({ created_by: user.email }, "-created_date", 100),
      ]);
      return { asPassenger: asPassenger || [], driverTrips: driverTrips || [] };
    },
    enabled: !!user?.email,
    staleTime: 30000,
  });

  // ─── Bookings made BY OTHER PEOPLE on MY driver trips ───
  // (so we can show banner when I'm the driver and they're the passenger)
  const myDriverTripIds = useMemo(
    () => (myBookings.driverTrips || []).map(t => t.id),
    [myBookings.driverTrips]
  );
  const { data: bookingsOnMyTrips = [] } = useQuery({
    queryKey: ["bookings-on-my-trips", myDriverTripIds.join(",")],
    queryFn: async () => {
      if (myDriverTripIds.length === 0) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .in("trip_id", myDriverTripIds);
      if (error) { console.warn("bookingsOnMyTrips error:", error); return []; }
      return data || [];
    },
    enabled: myDriverTripIds.length > 0,
    staleTime: 30000,
  });

  // ─── Fetch profile pictures for all chat participants ───
  const chatEmails = useMemo(() => {
    const set = new Set();
    if (user?.email) set.add(user.email);
    for (const m of rawMessages) {
      if (m.sender_email) set.add(m.sender_email);
      if (m.receiver_email) set.add(m.receiver_email);
    }
    return Array.from(set);
  }, [user?.email, rawMessages]);

  const { data: profilesByEmail = {} } = useQuery({
    // Spread before sort — `chatEmails` comes from useMemo so its
    // reference is reused across renders. .sort() mutates in place,
    // which would silently corrupt the memoized value (subsequent
    // comparisons see the already-sorted array). Spread guarantees
    // the sort doesn't reach back into useMemo's cached object.
    queryKey: ["chat-profiles", [...chatEmails].sort().join(",")],
    queryFn: async () => {
      if (chatEmails.length === 0) return {};
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .in("email", chatEmails);
        if (error) { console.warn("chat profiles error:", error); return {}; }
        const map = {};
        (data || []).forEach(p => {
          if (p.email) map[p.email] = p;
        });
        return map;
      } catch (e) {
        console.warn("chat profiles exception:", e);
        return {};
      }
    },
    enabled: chatEmails.length > 0,
    staleTime: 60000,
  });

  // ─── Collect all trip_ids referenced in messages + URL param ───
  const tripIdsRef = useMemo(() => {
    const ids = new Set();
    // From messages (most accurate — explicit link)
    for (const m of rawMessages) {
      if (m.trip_id) ids.add(m.trip_id);
    }
    // From URL param (for __new__ conversations)
    if (paramTrip) ids.add(paramTrip);
    // Fallback: from MY bookings (where I'm passenger)
    for (const b of (myBookings.asPassenger || [])) {
      if (b.trip_id) ids.add(b.trip_id);
    }
    // Fallback: from MY driver trips (where I'm driver)
    for (const t of (myBookings.driverTrips || [])) {
      ids.add(t.id);
    }
    return Array.from(ids).sort();
  }, [rawMessages, paramTrip, myBookings]);

  // ─── Fetch trip metadata for those ids ───
  const { data: relatedTrips = [] } = useQuery({
    queryKey: ["chat-trips", tripIdsRef.join(",")],
    queryFn: async () => {
      if (tripIdsRef.length === 0) return [];
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .in("id", tripIdsRef);
      if (error) { console.warn("Chat trips fetch error:", error); return []; }
      return data || [];
    },
    enabled: tripIdsRef.length > 0,
    staleTime: 30000,
  });

  const tripById = useMemo(() => {
    const m = new Map();
    for (const t of relatedTrips) m.set(t.id, t);
    return m;
  }, [relatedTrips]);

  // ─── Realtime subscription ───
  useEffect(() => {
    if (!user?.email) return;
    const unsub = api.entities.Message.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["messages", user.email] });
    });
    return () => unsub();
  }, [user?.email]);

  // ─── Group messages into conversations ───
  const conversations = useMemo(() => {
    const groups = new Map();
    for (const msg of rawMessages) {
      const otherEmail = msg.sender_email === user?.email ? msg.receiver_email : msg.sender_email;
      const otherName  = msg.sender_email === user?.email ? msg.receiver_name : msg.sender_name;
      if (!otherEmail) continue;
      // Per-trip / per-request grouping: when a message has trip_id OR request_id,
      // key by that-id+emailPair so trip A vs trip B vs request X between the
      // same two users render as separate threads. Falls back to conversation_id
      // (legacy) then email (oldest legacy).
      const emailPairKey = [user?.email || "", otherEmail].sort().join("__");
      const key = msg.trip_id
        ? `trip_${msg.trip_id}__${emailPairKey}`
        : (msg.request_id
          ? `request_${msg.request_id}__${emailPairKey}`
          : (msg.conversation_id || otherEmail));
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
    for (const conv of groups.values()) {
      conv.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0)
    );
  }, [rawMessages, user?.email]);

  // ─── Block-aware filtering ───
  // Drop conversations with anyone the user has blocked (or who blocked them)
  // before search filtering. The conversation rows still exist in the DB —
  // we just refuse to surface them as long as the block is in place.
  // Unblocking via /settings → "المستخدمون المحظورون" makes them reappear.
  const blockedSet = useBlockedEmails();
  const blockHidden = useMemo(() => {
    if (!blockedSet || blockedSet.size === 0) return conversations;
    return conversations.filter((c) => !blockedSet.has(c.otherEmail));
  }, [conversations, blockedSet]);

  // ─── Filter ───
  const filtered = search.trim()
    ? blockHidden.filter(c =>
        c.otherName?.toLowerCase().includes(search.toLowerCase()) ||
        c.otherEmail?.toLowerCase().includes(search.toLowerCase())
      )
    : blockHidden;

  // ─── Active conversation (existing OR new pending) ───
  const activeConv = useMemo(() => {
    if (activeId === "__new__" && newConv) {
      return { id: "__new__", otherEmail: newConv.email, otherName: newConv.name, messages: [], unreadCount: 0 };
    }
    return conversations.find(c => c.id === activeId) || null;
  }, [activeId, newConv, conversations]);

  // True if the currently-open conversation is with someone in the block set
  // (either I blocked them or they blocked me). Used to lock the composer
  // and show an inline notice — no more "I typed but my message went into
  // the void after I blocked them" surprise.
  const activeIsBlocked = !!(activeConv?.otherEmail && blockedSet.has(activeConv.otherEmail));

  // True if the other party has deleted their account (anonymized email
  // ending in @deleted.local). The DB enforces this with a RESTRICTIVE
  // RLS policy that returns 403; this constant just lets us show a
  // friendly notice instead of a raw error.
  const activeIsDeleted = isDeletedUserEmail(activeConv?.otherEmail);

  // ─── Auto-open from URL params (fires ONCE per to+trip+request URL combo) ───
  const autoOpenedRef = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!paramTo || !user?.email) return;
    if (paramTo === user.email) return;
    // Guard: only auto-open once per unique URL combo.
    // Without this, conversations.length changing (e.g. after send) re-fires
    // this effect and forces UI back to the URL's trip — closing the conv
    // the user just switched to.
    //
    // Include paramRequest in the key so navigating between two requests
    // with the same passenger re-fires correctly. Without it, the second
    // request would inherit the autoOpenedRef from the first and never
    // switch threads.
    const urlKey = `${paramTo}__${paramTrip || ''}__${paramRequest || ''}`;
    if (autoOpenedRef.current === urlKey) return;
    autoOpenedRef.current = urlKey;
    if (paramTrip) {
      // STRICT per-trip mode: only open existing thread if it's about THIS trip.
      // Otherwise force a fresh "__new__" — never fall back to email-pair convo.
      const tripScoped = conversations.find(c =>
        c.otherEmail === paramTo && c.messages?.some(m => m.trip_id === paramTrip)
      );
      if (tripScoped) {
        setActiveId(tripScoped.id);
        setNewConv(null);
      } else {
        setNewConv({ email: paramTo, name: decodeURIComponent(paramName || paramTo.split("@")[0]) });
        setActiveId("__new__");
      }
    } else if (paramRequest) {
      // STRICT per-request mode (same shape as the per-trip branch):
      // when the driver arrives from /passenger-requests/:id → 'راسل الراكب',
      // the chat must be scoped to THIS request specifically. If the driver
      // happens to already have a chat with this passenger from a different
      // context — e.g. the passenger booked a trip the driver posted last
      // week — falling through to the email-only match below would dump
      // the request reply into that old trip thread, which is exactly the
      // bug @souqnamarketplace reported.
      //
      // Match only on (otherEmail + a message with this request_id). If no
      // such thread exists, force "__new__" so the first send creates a
      // fresh conv keyed by request_id (see the requestIdToPersist branch
      // in the send handler below — it picks up paramRequest from the URL
      // when activeConv.id === "__new__").
      const requestScoped = conversations.find(c =>
        c.otherEmail === paramTo && c.messages?.some(m => m.request_id === paramRequest)
      );
      if (requestScoped) {
        setActiveId(requestScoped.id);
        setNewConv(null);
      } else {
        setNewConv({ email: paramTo, name: decodeURIComponent(paramName || paramTo.split("@")[0]) });
        setActiveId("__new__");
      }
    } else {
      // No trip or request context — legacy behavior, prefer existing email-pair convo.
      // This branch is reached only when the driver/passenger opens /messages
      // directly with just ?to=, e.g. from the profile page's "Message" button.
      const existing = conversations.find(c => c.otherEmail === paramTo);
      if (existing) {
        setActiveId(existing.id);
        setNewConv(null);
      } else {
        setNewConv({ email: paramTo, name: decodeURIComponent(paramName || paramTo.split("@")[0]) });
        setActiveId("__new__");
      }
    }
  }, [paramTo, paramTrip, paramRequest, user?.email, conversations.length]);

  // ─── Auto-scroll ───
  useEffect(() => {
    // Scroll only the messages list, NEVER the whole page.
    // scrollIntoView() walks up the parent chain to make the target visible,
    // which scrolls the page itself on mobile and pushes header/banner/composer
    // out of view. Setting scrollTop on the immediate scrollable parent
    // guarantees only THAT element scrolls — standard messaging-app pattern.
    if (!activeConv) return;
    const sentinel = messagesEndRef.current;
    if (!sentinel) return;
    const container = sentinel.parentElement;
    if (container && container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeId, activeConv?.messages?.length]);

  // ─── Mark as read ───
  // Previously this fired one UPDATE per unread message (Promise.all
  // of N individual queries). For a chat with 50 unread messages
  // that's 50 parallel network requests. Replaced with a single
  // UPDATE using .in() — one round trip regardless of unread count.
  //
  // SECONDARY: clear matching message-notifications. As of migration
  // 064, every new message inserts a notification row keyed by
  // type='message' and created_by=<sender_email>. Without this side-
  // effect, opening a chat would mark MESSAGES read but leave the
  // bell badge counting the (now-stale) notifications. Single
  // additional UPDATE keyed on (type, user_email, created_by, is_read)
  // — same shape as the messages mark-read, one round trip.
  useEffect(() => {
    if (!activeConv || !user?.email) return;
    const unread = activeConv.messages.filter(m => m.receiver_email === user.email && !m.is_read);
    if (unread.length === 0) return;
    const unreadIds = unread.map(m => m.id);
    // Distinct sender emails across the unread set. Usually 1 (the
    // other party) — defensive for edge cases like admin-impersonation
    // or future group-chat. Cap at the unique sender list to avoid
    // touching unrelated notification rows in batched calls.
    const senderEmails = Array.from(new Set(unread.map(m => m.sender_email).filter(Boolean)));
    supabase
      .from("messages")
      .update({ is_read: true })
      .in("id", unreadIds)
      .then(({ error }) => {
        if (error) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn("[Messages] mark-as-read failed:", error);
          }
          return;
        }
        qc.invalidateQueries({ queryKey: ["messages", user.email] });
        qc.invalidateQueries({ queryKey: ["unread-messages-count", user.email] });
        qc.invalidateQueries({ queryKey: ["mobile-msg-badge", user.email] });
      });
    // Clear message-type notifications from these senders. Best-effort:
    // the bell badge will eventually self-correct on next bell refresh
    // even if this UPDATE fails. Don't block messages mark-read on this.
    if (senderEmails.length > 0) {
      supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_email", user.email)
        .eq("type", "message")
        .eq("is_read", false)
        .in("created_by", senderEmails)
        .then(({ error }) => {
          if (error) {
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.warn("[Messages] notification mark-read failed:", error);
            }
            return;
          }
          qc.invalidateQueries({ queryKey: ["notifications", user.email] });
          qc.invalidateQueries({ queryKey: ["notifications-unread-count", user.email] });
        });
    }
  }, [activeId, activeConv, user?.email, qc]);

  // ─── Mobile chat overlay mode ───
  // When the user opens a conversation on a phone-sized viewport, the
  // MobileLayout bottom tab bar would otherwise sit between the message
  // composer and the keyboard, occluding the input field — the
  // composer is `sticky bottom-0` inside its column and the column's
  // visible bottom edge IS the tab bar. Toggle a body class that the
  // CSS rule in index.css uses to hide the tab bar (via the
  // [data-mobile-nav] attribute on MobileLayout's tab-bar div) for
  // the duration of an active conversation, matching how WhatsApp /
  // Telegram / iMessage drop their primary nav inside a thread.
  //
  // Listens to resize so the class stays correct if the user rotates
  // their device or resizes a desktop browser across the md
  // breakpoint (768px = Tailwind `md`, matching the grid's md:col-*
  // breakpoint elsewhere on this page).
  useEffect(() => {
    const apply = () => {
      const isMobileViewport = window.innerWidth < 768;
      if (activeConv && isMobileViewport) {
        document.body.classList.add("chat-overlay-active");
      } else {
        document.body.classList.remove("chat-overlay-active");
      }
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      // Always clean up on unmount — leaving the class on the body
      // after navigating away from /messages would hide the tab bar
      // on every other page until the next reload.
      document.body.classList.remove("chat-overlay-active");
    };
  }, [activeConv]);

  // ─── Find trip for a conversation ───
  // Priority order:
  // 1. trip_id explicitly saved on a message
  // 2. ?trip= URL param (for new conversations being started)
  // 3. Fallback: I'm passenger → find my booking with this driver
  // 4. Fallback: I'm driver → find this passenger's booking on one of my trips
  const getTripIdForConv = (conv) => {
    if (!conv) return null;
    // 1. Explicit trip_id on a message (most accurate)
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].trip_id) return conv.messages[i].trip_id;
    }
    // 2. URL param for fresh conversations
    if (conv.id === "__new__" && paramTrip) return paramTrip;
    // 3. Fallback: am I a passenger with this driver?
    const myBookingWithThem = (myBookings.asPassenger || []).find(b =>
      b.driver_email === conv.otherEmail || b.created_by === conv.otherEmail
    );
    if (myBookingWithThem?.trip_id) return myBookingWithThem.trip_id;
    // 4. Fallback: am I the driver and they booked one of my trips?
    const theirBookingOnMyTrip = (bookingsOnMyTrips || []).find(b =>
      b.passenger_email === conv.otherEmail
    );
    if (theirBookingOnMyTrip?.trip_id) return theirBookingOnMyTrip.trip_id;
    return null;
  };
  const getTripForConv = (conv) => {
    const tid = getTripIdForConv(conv);
    return tid ? tripById.get(tid) || null : null;
  };

  // ─── Booking status (drives banner color) ───
  const getBookingStatus = (trip) => {
    if (!trip) return "none";
    if (trip.status === "completed") return "completed";
    if (trip.status === "cancelled") return "cancelled";
    if (trip.driver_email === user?.email || trip.created_by === user?.email) return "driver";
    const myBooking = (myBookings.asPassenger || []).find(b => b.trip_id === trip.id);
    if (myBooking?.status === "confirmed") return "approved";
    if (myBooking?.status === "pending") return "pending";
    return "none";
  };

  // ─── Send mutation ───
  // Accepts either:
  //   • A plain string (QuickReplies / sendQuick path) — sent as text
  //   • An object: { text } | { attachment: { type:'image', url, path } }
  //                | { attachment: { type:'location', latitude, longitude } }
  //
  // The single-arg overload is preserved so the existing
  // QuickReplies / handleSubmit call sites don't need to change.
  // All mutations route through one INSERT path so trip/request
  // scoping, block guards, and the request-contact notification all
  // fire identically regardless of message_type.
  const send = useMutation({
    mutationFn: async (arg) => {
      // Normalize the argument into { text, attachment }.
      const opts = (typeof arg === "string" || arg === undefined)
        ? { text: arg }
        : (arg || {});
      const attachment = opts.attachment || null;
      const text = (opts.text !== undefined ? opts.text : draft).trim();
      // For text messages we still need text content to send.
      // For attachment messages we don't — the bubble renders the media.
      if (!attachment && !text) return;
      if (!activeConv || !user?.email) return;
      // Onboarding gate — RLS policy messages_require_onboarded_insert
      // (migration 034) is what actually blocks the INSERT server-side
      // for a non-onboarded user; this client check prevents the
      // wasted round-trip + opaque RLS error toast, and walks the user
      // to /onboarding with a returnTo back to /messages.
      if (!requireOnboarding("/messages")) return;
      // Refuse to send to a deleted (anonymized) account. The DB enforces
      // this with a RESTRICTIVE RLS policy; this client check just gives
      // the user a friendly toast instead of waiting for the 403.
      if (activeConv.otherEmail && isDeletedUserEmail(activeConv.otherEmail)) {
        toast.error("لا يمكن إرسال رسائل إلى مستخدم محذوف");
        return;
      }
      // Last line of defense — even if the composer somehow got rendered
      // (race on the block being added in another tab, optimistic UI, etc.),
      // refuse to insert the row. The user sees the error but the message
      // never reaches the recipient's inbox.
      if (activeConv.otherEmail && blockedSet.has(activeConv.otherEmail)) {
        toast.error("لا يمكنك مراسلة هذا المستخدم — أحدكما حظر الآخر");
        return;
      }
      // Text validation only applies to text messages. Media messages
      // are user-generated content of a different kind (image, location)
      // and the phone-number / off-platform-contact regex doesn't apply.
      let cleaned = "";
      if (attachment) {
        // Set a readable fallback content so legacy clients without
        // image/location render support (or push notification bodies
        // which display message.message but receive 'content' as the
        // body text) still see something meaningful.
        cleaned = attachment.type === "image"    ? "📷 صورة"
                : attachment.type === "location" ? "📍 موقع"
                : "";
      } else {
        cleaned = sanitizeText(text).slice(0, 5000);
        const violation = getContactViolation(cleaned);
        if (violation) { toast.error(violation, { duration: 5000 }); return; }
      }
      // Per-trip / per-request conversation IDs: a passenger booking 2 different
      // trips with the same driver gets 2 separate threads. Trip-request
      // conversations get their OWN thread too — request_id and trip_id are
      // mutually exclusive in practice. Falls back to email-pair if neither.
      // Use the active conv's trip context, NOT the stale URL paramTrip.
      // getTripIdForConv() already falls back to paramTrip when conv.id === '__new__'.
      const tripIdToPersist = getTripIdForConv(activeConv);
      // request_id is persisted ONLY when there's no trip context — they're
      // alternates, not stackable. paramRequest takes effect on the first
      // message (activeConv.id === '__new__' from /messages?...&request=X)
      // and then follow-ups inherit via the stored column.
      const lastRequestId = activeConv.messages
        ?.slice().reverse().find(m => m.request_id)?.request_id || null;
      const requestIdToPersist = !tripIdToPersist
        ? (lastRequestId || (activeConv.id === "__new__" ? paramRequest : null))
        : null;
      const emailPair = [user.email, activeConv.otherEmail].sort().join("__");
      const convId = activeConv.id === "__new__"
        ? (tripIdToPersist
            ? `trip_${tripIdToPersist}__${emailPair}`
            : (requestIdToPersist
                ? `request_${requestIdToPersist}__${emailPair}`
                : emailPair))
        : activeConv.id;
      // Build the per-type insert payload. The DB has a CHECK constraint
      // (migration 063) that enforces consistency between message_type
      // and the attachment/lat-lng columns; passing the wrong combination
      // would surface as a CHECK violation, but our switch here keeps
      // us in lockstep with the constraint.
      const insertPayload = {
        conversation_id: convId,
        sender_email:   user.email,
        sender_name:    user.full_name || user.email.split("@")[0],
        receiver_email: activeConv.otherEmail,
        receiver_name:  activeConv.otherName || activeConv.otherEmail.split("@")[0],
        content:        cleaned,
        is_read:        false,
        message_type:   attachment?.type || "text",
        trip_id:        tripIdToPersist || null,
        request_id:     requestIdToPersist,
        attachment_url:  attachment?.type === "image"    ? attachment.url       : null,
        attachment_path: attachment?.type === "image"    ? attachment.path      : null,
        latitude:        attachment?.type === "location" ? attachment.latitude  : null,
        longitude:       attachment?.type === "location" ? attachment.longitude : null,
      };
      const { error: msgErr } = await supabase.from("messages").insert(insertPayload);
      if (msgErr) {
        // Orphan-cleanup: if the message INSERT failed AFTER we uploaded
        // an attachment to storage, delete the storage object so the
        // bucket doesn't accumulate orphans. deleteAttachment is best-
        // effort and silent on failure (we're already in an error path).
        if (attachment?.type === "image" && attachment.path) {
          await deleteAttachment(attachment.path);
        }
        console.error("Message insert error:", msgErr);
        throw new Error(msgErr.message);
      }

      // ─── Trip-request notification (audit-fixed in commit ?) ───
      // When a driver sends their first message about a passenger trip
      // request, the passenger gets a notification "سائق مهتم برحلتك".
      // Conditions:
      //   - paramRequest is present (driver navigated from /passenger-requests)
      //   - This is the first message in the thread for this request
      // Uses the SECURITY DEFINER RPC notify_request_contact (migration 021)
      // which substitutes for the RLS path the driver doesn't have — they
      // can't INSERT into notifications.user_email != caller's email under
      // notifications_insert policy. The RPC validates the request exists,
      // refuses self-contact, and respects block-pair.
      // Best-effort: failures don't block the message send.
      if (paramRequest && activeConv.id === "__new__") {
        try {
          await supabase.rpc("notify_request_contact", { p_request_id: paramRequest });
        } catch (e) { console.warn("Request-contact notification failed:", e); }
      }

      // Only clear the draft on TEXT sends. For attachment sends, the
      // user may have typed something while picking the image — don't
      // wipe their in-progress text just because they sent a media
      // message in parallel.
      if (!attachment) setDraft("");
      setNewConv(null);
      // Only change activeId if we just transitioned out of "__new__".
      // Otherwise we'd overwrite the trip-scoped id (trip_X__a__b) with the
      // legacy email-pair id (a__b), which doesn't match any conversation
      // key in trip-scoped grouping — making activeConv go null and the
      // chat pane appear to "close" immediately on send.
      if (activeConv.id === "__new__") {
        setActiveId(convId);
      }
      qc.invalidateQueries({ queryKey: ["messages", user?.email] });
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر إرسال الرسالة")),
  });
  const sendQuick = (text) => send.mutate(text);

  // Image-attachment send. Compresses, uploads, then routes through the
  // unified send mutation with attachment metadata. We do the compress +
  // upload OUTSIDE the mutation so the loading toast can wrap the whole
  // operation and the mutation's mutationFn stays focused on inserting
  // the messages row.
  const sendImage = async (file) => {
    if (!file || !user?.email) return;
    const tId = toast.loading("جاري رفع الصورة...");
    try {
      const blob = await compressImage(file);
      const { url, path } = await uploadAttachment(blob, user.email);
      await send.mutateAsync({ attachment: { type: "image", url, path } });
      toast.dismiss(tId);
    } catch (err) {
      toast.dismiss(tId);
      toast.error(friendlyError(err, "تعذر إرسال الصورة"));
    }
  };

  // Location-attachment send. Asks the OS for current location then
  // inserts a message with lat/lng. The user-visible content fallback
  // is set inside the send mutation ('📍 موقع') so push notifications
  // and legacy clients show something meaningful.
  const sendLocation = async () => {
    if (!user?.email) return;
    const tId = toast.loading("جاري تحديد موقعك...");
    try {
      const { latitude, longitude } = await getCurrentLocation();
      await send.mutateAsync({ attachment: { type: "location", latitude, longitude } });
      toast.dismiss(tId);
    } catch (err) {
      toast.dismiss(tId);
      toast.error(err?.message || "تعذر تحديد الموقع");
    }
  };

  // ─── Group active messages by date for separators ───
  const groupedMessages = useMemo(() => {
    if (!activeConv?.messages?.length) return [];
    const groups = [];
    let lastDateKey = null;
    for (const m of activeConv.messages) {
      const dateKey = new Date(m.created_at).toDateString();
      if (dateKey !== lastDateKey) {
        groups.push({ type: "separator", date: m.created_at, key: `s-${dateKey}` });
        lastDateKey = dateKey;
      }
      groups.push({ type: "msg", message: m, key: `m-${m.id}` });
    }
    return groups;
  }, [activeConv]);

  const activeTrip = activeConv ? getTripForConv(activeConv) : null;
  const activeBookingStatus = getBookingStatus(activeTrip);
  const isChatLocked =
    activeBookingStatus === "completed" ||
    activeBookingStatus === "cancelled" ||
    activeTrip?.status === "completed" ||
    activeTrip?.status === "cancelled";

  return (
    <>
      <div
        className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8"
        data-messages-wrapper
        dir="rtl"
      >
        {/* Page title block — hidden on mobile because MobileLayout's
            sticky header already shows "الرسائل" at the top of the
            viewport. Rendering it again here on mobile pushed every
            conversation card ~110px down and wasted the top half of
            the screen inside an active chat. On md+ (two-pane layout)
            the title still anchors the page above the side-by-side
            list+chat columns, so we keep it there. */}
        <div className="hidden md:block text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <MessageCircle className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">الرسائل</h1>
          <p className="text-muted-foreground text-sm mt-1">محادثاتك مع السائقين والركاب</p>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-0 bg-card rounded-2xl border border-border overflow-hidden"
          style={{ minHeight: "70vh" }}
          data-messages-grid
        >
          {/* ── Sidebar ── */}
          <div className={`md:col-span-1 border-l border-border ${activeConv ? "hidden md:block" : ""}`}>
            <div className="p-3 border-b border-border sticky top-0 bg-card z-10">
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
                  const trip = getTripForConv(conv);
                  const status = getBookingStatus(trip);
                  return (
                    <ConversationListItem
                      key={conv.id}
                      conv={conv}
                      trip={trip}
                      bookingStatus={status}
                      active={activeId === conv.id}
                      mineEmail={user?.email}
                      onClick={() => setActiveId(conv.id)}
                      imgSrc={getProfilePic(profilesByEmail[conv.otherEmail])}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Active chat ── */}
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
                <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card">
                  <button onClick={() => setActiveId(null)} className="md:hidden p-2 -m-2 rounded-lg hover:bg-muted/50" aria-label="رجوع">
                    <ArrowLeft className="w-5 h-5 rotate-180" />
                  </button>
                  <Avatar name={activeConv.otherName} size={40} imgSrc={getProfilePic(profilesByEmail[activeConv.otherEmail])} />
                  <div className="flex-1 min-w-0">
                    {/* Profile link uses the canonical UUID path. The id
                        comes from profilesByEmail which is fetched on chat
                        load — see the chat-profiles useQuery above. If
                        the profile hasn't been fetched yet (first paint,
                        rare), render a non-linked span instead of falling
                        back to the email URL — email-in-URL is the leak
                        we just fixed and we shouldn't reintroduce it as
                        a "graceful degradation". */}
                    {profilesByEmail[activeConv.otherEmail]?.id ? (
                      <Link
                        to={`/profile/${profilesByEmail[activeConv.otherEmail].id}`}
                        className="font-semibold text-base text-foreground hover:underline truncate block"
                      >
                        {activeConv.otherName}
                      </Link>
                    ) : (
                      <span className="font-semibold text-base text-foreground truncate block">
                        {activeConv.otherName}
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground truncate">{activeConv.otherEmail}</p>
                  </div>
                  {/* Block / Report — same component used on TripDetails &
                      UserProfile. The trip context (when present) is passed
                      so admins reviewing the report can jump back to the
                      trip the conversation related to. Hides itself when
                      target equals current user. */}
                  <UserActionsMenu
                    targetEmail={activeConv.otherEmail}
                    targetName={activeConv.otherName}
                    contextType={activeTrip ? "trip" : "message"}
                    contextId={activeTrip?.id || activeConv.id}
                  />
                </div>

                {/* Trip Status Bar (dark navy / red / amber) */}
                {activeTrip && <TripStatusBar trip={activeTrip} />}

                {/* Trip Context Banner (green / amber / blue / grey) */}
                {activeTrip && (
                  <TripContextBanner
                    trip={activeTrip}
                    bookingStatus={activeBookingStatus}
                    otherName={activeConv.otherName}
                    onClick={() => navigate(`/trip/${activeTrip.id}`)}
                  />
                )}

                {/* Messages */}
                <div
                  className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-muted/10"
                  style={{ maxHeight: "55vh" }}
                  data-messages-thread
                >
                  {groupedMessages.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      ابدأ المحادثة بإرسال أول رسالة
                    </div>
                  ) : groupedMessages.map(item => {
                    if (item.type === "separator") {
                      return <DateSeparator key={item.key} iso={item.date} />;
                    }
                    const m = item.message;
                    const mine = m.sender_email === user?.email;
                    return (
                      <MessageBubble
                        key={item.key}
                        message={m}
                        mine={mine}
                        otherName={activeConv.otherName}
                        otherImgSrc={getProfilePic(profilesByEmail[activeConv.otherEmail])}
                      />
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Locked notice OR quick replies + input */}
                {activeIsDeleted ? (
                  <div className="px-4 py-3 border-t border-border bg-muted/40">
                    <p className="text-sm text-muted-foreground font-medium text-center">
                      ⚪️ هذا المستخدم حذف حسابه — لا يمكن إرسال رسائل
                    </p>
                  </div>
                ) : activeIsBlocked ? (
                  <div className="px-4 py-3 border-t border-border bg-destructive/5">
                    <p className="text-sm text-destructive font-medium text-center">
                      🚫 لا يمكنك مراسلة هذا المستخدم — أحدكما حظر الآخر
                    </p>
                    <p className="text-xs text-muted-foreground text-center mt-1">
                      يمكنك إدارة قائمة الحظر من <Link to="/settings?section=blocked" className="text-primary underline">الإعدادات</Link>
                    </p>
                  </div>
                ) : isChatLocked ? (
                  <ClosedNotice status={activeBookingStatus} />
                ) : (
                  <>
                    <QuickReplies onPick={sendQuick} disabled={send.isPending} bookingStatus={activeBookingStatus} />
                    <MessageInput
                      draft={draft}
                      setDraft={setDraft}
                      onSend={() => send.mutate()}
                      onSendImage={sendImage}
                      onSendLocation={sendLocation}
                      disabled={send.isPending}
                      violation={getContactViolation(draft)}
                      otherName={activeConv.otherName}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {pendingReview && (
        <PassengerReviewWizard
          trip={pendingReview.trip}
          driverEmail={pendingReview.driverEmail}
          driverName={pendingReview.driverName}
          passengerUser={user}
          onClose={() => setPendingReview(null)}
        />
      )}
    </>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function Avatar({ name, size = 40, className = "", imgSrc = null }) {
  const [imgErr, setImgErr] = React.useState(false);
  const showImg = imgSrc && !imgErr;
  return (
    <div
      className={`rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {showImg ? (
        <img
          src={imgSrc}
          alt={name || ""}
          className="w-full h-full object-cover"
          onError={() => setImgErr(true)}
          loading="lazy"
        />
      ) : (
        (name?.[0] || "؟").toUpperCase()
      )}
    </div>
  );
}

// Helper: try multiple common profile-picture field names
function getProfilePic(profile) {
  if (!profile) return null;
  return profile.profile_picture
      || profile.avatar
      || profile.avatar_url
      || profile.photo_url
      || profile.selfie_url
      || profile.picture
      || null;
}

function ConversationListItem({ conv, trip, bookingStatus, active, mineEmail, onClick, imgSrc }) {
  const last = conv.lastMessage;
  const isMe = last?.sender_email === mineEmail;
  const dotColor = {
    approved:  "bg-green-500",
    pending:   "bg-amber-500",
    driver:    "bg-blue-500",
    completed: "bg-slate-500",
    cancelled: "bg-red-500",
    none:      "bg-muted-foreground/40",
  }[bookingStatus];
  const priceBadgeColor = {
    approved:  "bg-green-500 text-white",
    pending:   "bg-amber-500 text-white",
    driver:    "bg-blue-500 text-white",
    completed: "bg-slate-700 text-white",
    cancelled: "bg-red-500 text-white",
    none:      "bg-card border border-border text-foreground",
  }[bookingStatus];

  return (
    <button
      onClick={onClick}
      className={`w-full text-right px-3 py-3 border-b border-border/40 hover:bg-muted/40 transition-colors ${active ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar name={conv.otherName} size={48} imgSrc={imgSrc} />
          {trip?.price && (
            <span className={`absolute -top-1 -right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm ${priceBadgeColor}`}>
              ₪{trip.price}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="font-bold text-sm text-foreground truncate">{conv.otherName}</p>
            {last && <span className="text-[10px] text-muted-foreground shrink-0">{formatTimeShort(last.created_at)}</span>}
          </div>
          {trip && (
            <p className="text-xs text-foreground truncate mb-0.5 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
              <span className="truncate">{trip.from_city} ← {trip.to_city}</span>
              {trip.date && <span className="text-muted-foreground shrink-0">• {formatDateShort(trip.date)}</span>}
            </p>
          )}
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
}

function TripStatusBar({ trip }) {
  if (trip.status === "completed") {
    return (
      <div className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold flex items-center justify-between">
        <span>🏁 الرحلة مكتملة</span>
      </div>
    );
  }
  if (trip.status === "cancelled") {
    return (
      <div className="px-4 py-2 bg-red-600 text-white text-sm font-semibold flex items-center justify-between">
        <span>❌ تم إلغاء الرحلة</span>
      </div>
    );
  }
  if (trip.status === "in_progress") {
    return (
      <div className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold flex items-center justify-between">
        <span>🚗 الرحلة قيد التنفيذ</span>
      </div>
    );
  }
  return null;
}

function TripContextBanner({ trip, bookingStatus, otherName, onClick }) {
  const cfg = {
    approved:  { bg: "bg-green-600",   text: "text-white",      label: "تم تأكيد الحجز" },
    pending:   { bg: "bg-amber-500",   text: "text-white",      label: "بانتظار الموافقة" },
    driver:    { bg: "bg-blue-600",    text: "text-white",      label: "أنت السائق" },
    completed: { bg: "bg-slate-700",   text: "text-white",      label: "رحلة مكتملة" },
    cancelled: { bg: "bg-red-600",     text: "text-white",      label: "ملغاة" },
    none:      { bg: "bg-muted",       text: "text-foreground", label: "لم يُحجز بعد" },
  }[bookingStatus] || { bg: "bg-muted", text: "text-foreground", label: "" };

  const isLight = bookingStatus === "none";
  const subTextColor = isLight ? "text-muted-foreground" : "text-white/85";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full ${cfg.bg} ${cfg.text} px-4 py-3 text-right hover:opacity-95 transition-opacity flex items-center gap-3 border-b border-black/10`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
          <span className="truncate">{otherName}</span>
          <span className={subTextColor}>•</span>
          <span className="text-xs font-medium">{cfg.label}</span>
          {trip.price && (
            <>
              <span className={subTextColor}>•</span>
              <span className="text-xs font-medium">₪{trip.price} للمقعد</span>
            </>
          )}
        </div>
        <div className={`text-xs mt-0.5 ${subTextColor} truncate flex items-center gap-1.5`}>
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{trip.from_city} إلى {trip.to_city}</span>
          {trip.date && <span> • {formatDateShort(trip.date)}</span>}
          {trip.time && <span> {trip.time}</span>}
        </div>
      </div>
      <ChevronLeft className="w-5 h-5 opacity-80 shrink-0" />
    </button>
  );
}

function DateSeparator({ iso }) {
  return (
    <div className="flex items-center justify-center my-3">
      <span className="text-[11px] text-muted-foreground bg-card px-3 py-1 rounded-full border border-border/50">
        {formatDateLabel(iso)}
      </span>
    </div>
  );
}

function MessageBubble({ message, mine, otherName, otherImgSrc }) {
  // Branch on message_type. Legacy rows pre-migration 063 don't have
  // the column set — null/undefined falls through to the text path,
  // preserving rendering of every existing message.
  const type = message.message_type || "text";

  if (type === "image" && message.attachment_url) {
    return (
      <ImageBubble
        message={message}
        mine={mine}
        otherName={otherName}
        otherImgSrc={otherImgSrc}
      />
    );
  }
  if (type === "location" && message.latitude != null && message.longitude != null) {
    return (
      <LocationBubble
        message={message}
        mine={mine}
        otherName={otherName}
        otherImgSrc={otherImgSrc}
      />
    );
  }

  // Text — default and fallback. If somehow an image-type message
  // arrives without attachment_url (corrupt row, partial insert), we
  // still render its `content` so the receiver isn't left staring at
  // an empty bubble.
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-start" : "justify-end flex-row-reverse"}`}>
      {!mine && <Avatar name={otherName} size={28} className="mb-1" imgSrc={otherImgSrc} />}
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
        mine
          ? "bg-primary text-primary-foreground rounded-br-md"
          : "bg-card border border-border rounded-bl-md"
      }`}>
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        <p className={`text-[10px] mt-0.5 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"} text-left`}>
          {formatTimeShort(message.created_at)}
        </p>
      </div>
    </div>
  );
}

// Image bubble — thumbnail rendered as <img>, tap to open a fullscreen
// viewer (portal-mounted to escape any overflow:hidden containers in
// the chat scroll area). The thumbnail uses object-cover with a max
// height so very-tall portrait photos don't blow up the bubble layout.
function ImageBubble({ message, mine, otherName, otherImgSrc }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-start" : "justify-end flex-row-reverse"}`}>
      {!mine && <Avatar name={otherName} size={28} className="mb-1" imgSrc={otherImgSrc} />}
      <div className={`max-w-[75%] rounded-2xl overflow-hidden ${
        mine
          ? "bg-primary rounded-br-md"
          : "bg-card border border-border rounded-bl-md"
      }`}>
        <button
          type="button"
          onClick={() => !failed && setViewerOpen(true)}
          className="block relative bg-black/5 min-w-[160px] min-h-[120px]"
          aria-label={failed ? "تعذر تحميل الصورة" : "فتح الصورة"}
        >
          {!loaded && !failed && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {failed ? (
            <div className="px-6 py-8 text-xs text-muted-foreground text-center">
              تعذر تحميل الصورة
            </div>
          ) : (
            <img
              src={message.attachment_url}
              alt=""
              loading="lazy"
              decoding="async"
              className={`block max-w-[280px] max-h-[360px] w-auto h-auto object-cover transition-opacity ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setLoaded(true)}
              onError={() => { setLoaded(true); setFailed(true); }}
            />
          )}
        </button>
        <p className={`text-[10px] px-2 py-1 ${
          mine ? "text-primary-foreground/70" : "text-muted-foreground"
        } text-left`}>
          {formatTimeShort(message.created_at)}
        </p>
      </div>
      {viewerOpen && createPortal(
        <ImageViewer url={message.attachment_url} onClose={() => setViewerOpen(false)} />,
        document.body
      )}
    </div>
  );
}

// Fullscreen image viewer — portal to document.body so it escapes any
// overflow:hidden containers in the chat scroll area. ESC and backdrop
// click close. Body scroll is locked while the viewer is open so two-
// finger zoom on the image doesn't accidentally scroll the chat.
function ImageViewer({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        aria-label="إغلاق"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={url}
        alt=""
        // Stop click propagation so tapping the image itself doesn't
        // close the viewer — only the backdrop click should close.
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}

// Location bubble — small Leaflet map preview + 'Open in Maps' link.
//
// PERFORMANCE — INTERSECTIONOBSERVER LAZY MOUNT
// A long thread with many location messages could mount many Leaflet
// instances simultaneously, each pulling tile resources. We use an
// IntersectionObserver to defer the map init until the bubble actually
// scrolls into view, then KEEP it mounted (we don't unmount on
// off-screen — that would re-init on every scroll past). Same
// pattern as lazy image loading: pay the cost once, when visible.
//
// LAYOUT — RESERVE SPACE BEFORE MOUNT
// The map container has fixed dimensions (240x160) reserved BEFORE
// the map mounts. Without this, the bubble would be small until the
// map mounted and then jump in size — bad UX on a scrolling thread.
//
// INTERACTION — READ-ONLY
// Tap/click the map → opens Google Maps externally. No pan, no zoom,
// no double-tap-to-zoom. The bubble is a preview; the real navigation
// is the external maps app.
function LocationBubble({ message, mine, otherName, otherImgSrc }) {
  const url = buildMapsUrl(message.latitude, message.longitude);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  // Watch for visibility — only mount the map when the bubble enters
  // the viewport. rootMargin: '200px' pre-mounts maps that are about
  // to be scrolled into view, smoothing the scroll experience without
  // bulk-mounting offscreen ones.
  useEffect(() => {
    if (mounted) return;
    if (!mapContainerRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      // Old browser without IntersectionObserver — mount immediately.
      // Functionally equivalent; trades the perf optimization for
      // baseline correctness.
      setMounted(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setMounted(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(mapContainerRef.current);
    return () => obs.disconnect();
  }, [mounted]);

  // Mount the Leaflet map once `mounted` flips true. Cleanup on unmount
  // — important because the bubble could be unmounted by React when
  // virtualization kicks in or the conversation changes; without
  // map.remove() the Leaflet instance would leak its container + tile
  // listeners.
  useEffect(() => {
    if (!mounted) return;
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;     // defensive — never double-init

    let cancelled = false;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !mapContainerRef.current) return;
        // Ensure Leaflet CSS is on the page. Loaded once globally for
        // the whole app (idempotent — same id, same href as the
        // city-picker uses), so subsequent bubbles just rely on it
        // being present.
        if (!document.getElementById("mishwar-leaflet-css")) {
          const link = document.createElement("link");
          link.id   = "mishwar-leaflet-css";
          link.rel  = "stylesheet";
          link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
          document.head.appendChild(link);
        }
        const lat = Number(message.latitude);
        const lng = Number(message.longitude);
        const map = L.map(mapContainerRef.current, {
          center: [lat, lng],
          zoom: 15,
          // Read-only preview — kill every interaction.
          dragging:         false,
          scrollWheelZoom:  false,
          doubleClickZoom:  false,
          touchZoom:        false,
          boxZoom:          false,
          keyboard:         false,
          zoomControl:      false,
          attributionControl: false,
          tap:              false,   // disables the click-after-touch
        });
        mapInstanceRef.current = map;

        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          { subdomains: "abcd", maxZoom: 19, attribution: "" }
        ).addTo(map);

        // Use a CircleMarker instead of the default icon — avoids the
        // marker-icon-broken-in-Vite dance (fixLeafletIcons elsewhere)
        // and renders crisply at any retina density. The bullseye look
        // also reads as "you are here" without the pin-shape ambiguity.
        L.circleMarker([lat, lng], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#1a3d2a",   // mishwaro forest green
          fillOpacity: 1,
        }).addTo(map);
      } catch (e) {
        // Leaflet load failure — leave the placeholder div visible.
        // The 'Open in Maps' link below still works, so the bubble
        // remains useful even if the preview never renders.
        if (import.meta.env.DEV) {
          console.warn("LocationBubble map init failed:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch { /* */ }
        mapInstanceRef.current = null;
      }
    };
  }, [mounted, message.latitude, message.longitude]);

  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-start" : "justify-end flex-row-reverse"}`}>
      {!mine && <Avatar name={otherName} size={28} className="mb-1" imgSrc={otherImgSrc} />}
      <div className={`max-w-[75%] rounded-2xl overflow-hidden ${
        mine
          ? "bg-primary text-primary-foreground rounded-br-md"
          : "bg-card border border-border rounded-bl-md"
      }`}>
        {/* Map preview — wraps the map div in an anchor so the entire
            preview is the tap target for opening external maps. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="فتح الموقع في الخرائط"
          className="block"
        >
          <div
            ref={mapContainerRef}
            className="w-[240px] h-[160px] bg-muted relative"
          >
            {/* Placeholder while map hasn't mounted yet — shows a pin
                centered in the reserved space so the layout never
                shifts when the real tiles paint over the top. */}
            {!mounted && (
              <div className="absolute inset-0 flex items-center justify-center">
                <MapPin className="w-7 h-7 text-muted-foreground/60" />
              </div>
            )}
          </div>
          <div className={`flex items-center gap-2 px-3 py-2 ${
            mine ? "text-primary-foreground" : "text-foreground"
          }`}>
            <MapPin className={`w-4 h-4 ${mine ? "text-primary-foreground" : "text-primary"}`} />
            <span className="text-sm font-medium">موقع مُشارَك</span>
            <span className={`text-xs ml-auto ${mine ? "text-primary-foreground/70" : "text-muted-foreground"} underline`}>
              فتح ←
            </span>
          </div>
        </a>
        <p className={`text-[10px] px-3 pb-1 ${
          mine ? "text-primary-foreground/70" : "text-muted-foreground"
        } text-left`}>
          {formatTimeShort(message.created_at)}
        </p>
      </div>
    </div>
  );
}

function QuickReplies({ onPick, disabled, bookingStatus }) {
  const replies = getQuickReplies(bookingStatus);
  return (
    <div
      className="px-3 pt-3 pb-1 flex items-center gap-2 overflow-x-auto bg-card border-t border-border"
      style={{ scrollbarWidth: "none" }}
    >
      {replies.map((q, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(q)}
          disabled={disabled}
          className="shrink-0 text-xs whitespace-nowrap px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-foreground border border-border/50 disabled:opacity-50 min-h-[36px]"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

function MessageInput({ draft, setDraft, onSend, onSendImage, onSendLocation, disabled, violation, otherName }) {
  // When the user taps the input on a mobile device, the OS keyboard
  // animates up and the WKWebView resizes. Add a small delay then scroll
  // the input into view — this is the belt-and-suspenders fix that
  // handles both iOS and Android edge cases where the composer might
  // otherwise sit just below the keyboard on first focus.
  const handleFocus = (e) => {
    const el = e.currentTarget;
    // 300ms matches the iOS keyboard animation duration (~250ms + buffer).
    setTimeout(() => {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch { /* old browsers without scrollIntoView options */ }
    }, 300);
  };

  // Attachment menu — closed by default, opens above the paperclip
  // button. A separate piece of state for each picker would be
  // wasteful; one bool + two refs (file inputs) cover both flows.
  const [attachOpen, setAttachOpen] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const menuRef = useRef(null);

  // Close the menu on outside click. The paperclip button itself sits
  // inside the menu's parent so a click on it is handled by its own
  // onClick; this listener handles taps elsewhere.
  useEffect(() => {
    if (!attachOpen) return;
    const handler = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setAttachOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [attachOpen]);

  // Reset the file input value after each pick so the same image can
  // be re-picked. Without this, picking the same file twice in a row
  // fires no onChange because the value didn't change.
  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setAttachOpen(false);
    if (file && onSendImage) onSendImage(file);
  };

  const handleLocationPick = () => {
    setAttachOpen(false);
    if (onSendLocation) onSendLocation();
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onSend(); }}
      className="p-3 border-t border-border sticky bottom-0 bg-card"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      {violation && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-2 text-right">
          {violation}
        </div>
      )}
      <div className="flex items-center gap-2">
        {/* Attachment trigger + menu container. The menu is positioned
            ABSOLUTE relative to this wrapper so it floats above the
            composer without taking up layout space. */}
        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => setAttachOpen(o => !o)}
            className="rounded-full h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={attachOpen ? "إغلاق قائمة الإرفاق" : "إرفاق"}
          >
            <Paperclip className={`w-5 h-5 transition-transform ${attachOpen ? "rotate-45" : ""}`} />
          </Button>
          {attachOpen && (
            <div
              className="absolute bottom-full mb-2 left-0 bg-card border border-border rounded-2xl shadow-lg overflow-hidden min-w-[180px] z-50"
              dir="rtl"
            >
              <button
                type="button"
                onClick={() => { setAttachOpen(false); cameraInputRef.current?.click(); }}
                className="flex items-center gap-3 px-4 py-3 w-full hover:bg-muted/50 active:bg-muted text-sm text-foreground"
              >
                <Camera className="w-4 h-4 text-primary" />
                التقاط صورة
              </button>
              <button
                type="button"
                onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}
                className="flex items-center gap-3 px-4 py-3 w-full hover:bg-muted/50 active:bg-muted text-sm text-foreground border-t border-border/60"
              >
                <ImageIcon className="w-4 h-4 text-primary" />
                اختيار من المعرض
              </button>
              <button
                type="button"
                onClick={handleLocationPick}
                className="flex items-center gap-3 px-4 py-3 w-full hover:bg-muted/50 active:bg-muted text-sm text-foreground border-t border-border/60"
              >
                <MapPin className="w-4 h-4 text-primary" />
                مشاركة الموقع
              </button>
            </div>
          )}
        </div>
        {/* Two hidden file inputs:
              - cameraInputRef has `capture="environment"` which on iOS
                + Android opens the camera directly instead of the
                gallery. Desktop browsers ignore capture and show
                the file picker.
              - fileInputRef has no capture, so it opens the gallery
                on mobile and the disk picker on desktop.
            Both accept image/* so HEIC, JPEG, PNG, WebP all work. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleFilePick}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFilePick}
        />
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={handleFocus}
          placeholder={`رسالة إلى ${otherName}...`}
          className={`rounded-full h-11 flex-1 ${violation ? "border-destructive focus-visible:ring-destructive" : ""}`}
          disabled={disabled}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!draft.trim() || disabled || !!violation}
          className="rounded-full bg-primary text-primary-foreground h-11 w-11 shrink-0"
          aria-label="إرسال"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </form>
  );
}

function ClosedNotice({ status }) {
  return (
    <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Lock className="w-4 h-4 shrink-0" />
      {status === "completed"
        ? "انتهت الرحلة — المحادثة مغلقة 🏁"
        : "تم إلغاء الرحلة — المحادثة مغلقة"}
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================

function formatTimeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = typeof iso === "string" && iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // Palestinian standard: DD/MM/YYYY
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "اليوم";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "أمس";
  // Within last 7 days: show weekday name (e.g. الأحد)
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays >= 0 && diffDays < 7) {
    return d.toLocaleDateString("ar-EG", { weekday: "long" });
  }
  // Older: Palestinian DD/MM/YYYY format
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
