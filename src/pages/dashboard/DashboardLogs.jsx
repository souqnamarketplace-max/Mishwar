import React, { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Car, CalendarCheck, Star, Users, MessageSquarePlus, Flag,
  Search, Calendar, Mail, Download, ChevronDown, ChevronUp, Shield, X,
} from "lucide-react";
import Pagination from "@/components/dashboard/Pagination";

// ────────────────────────────────────────────────────────────────────────────
// Visual config — keys match server-side `target_type` / activity-log type
// ────────────────────────────────────────────────────────────────────────────
const typeConfig = {
  booking:       { label: "حجز",         icon: CalendarCheck,     color: "text-accent bg-accent/10" },
  trip:          { label: "رحلة",        icon: Car,               color: "text-primary bg-primary/10" },
  // Passenger-posted ride requests separated from driver-posted trips so
  // admins can filter to just "passengers asking for a ride" without
  // scrolling past every driver-side trip activity. Mapping is server-side
  // in _map_audit_to_activity_type (migration 122).
  trip_request:  { label: "طلب رحلة",    icon: MessageSquarePlus, color: "text-accent bg-accent/15" },
  review:        { label: "تقييم",       icon: Star,              color: "text-yellow-600 bg-yellow-500/10" },
  user:          { label: "مستخدم",      icon: Users,             color: "text-blue-600 bg-blue-500/10" },
  feedback:      { label: "اقتراح/شكوى", icon: MessageSquarePlus, color: "text-purple-600 bg-purple-500/10" },
  report:        { label: "بلاغ",        icon: Flag,              color: "text-red-600 bg-red-500/10" },
  // Admin-trail-only types — surfaced when a row's target_type is one of
  // these. Activity-log doesn't emit these; audit_log_search does.
  payment:       { label: "دفع",         icon: CalendarCheck,     color: "text-green-700 bg-green-500/10" },
  system:        { label: "نظام",        icon: Shield,            color: "text-slate-600 bg-slate-500/10" },
};

const TYPE_FILTERS = [
  { id: "all",          label: "الكل" },
  { id: "trip",         label: "الرحلات" },
  { id: "trip_request", label: "طلبات الركاب" },
  { id: "booking",      label: "الحجوزات" },
  { id: "review",       label: "التقييمات" },
  { id: "user",         label: "المستخدمون" },
  { id: "feedback",     label: "الاقتراحات والشكاوى" },
  { id: "report",       label: "البلاغات" },
];

// Arabic labels for every audit `action` code logged by the app. Source
// codes are canonical snake_case English so server-side search/grep
// stays sane — but admins see them in Arabic. New action codes that
// aren't in this map fall through to a prettified version of the raw
// code (snake_case → "Title Case"), so adding new actions doesn't
// require a code change to keep the log readable. The raw code is also
// preserved in parentheses in the expanded detail view so anyone
// debugging can still grep / search by the original identifier.
//
// Keep this list synced with every logAdminAction() / logAudit() call
// site. Search the repo for those calls to find the full set.
const ACTION_LABELS = {
  // Bookings
  booking_created:                "إنشاء حجز",
  booking_confirmed:              "تأكيد حجز",
  booking_cancelled_by_passenger: "إلغاء حجز من الراكب",
  driver_confirm_booking:         "تأكيد السائق للحجز",
  driver_reject_booking:          "رفض السائق للحجز",
  driver_cancel_confirmed_booking:"إلغاء السائق لحجز مؤكد",
  admin_update_booking_status:    "تحديث حالة حجز (إداري)",

  // Trips
  trip_created:                   "إنشاء رحلة",
  trip_request_created:           "طلب رحلة من راكب",
  driver_start_trip:              "بدء الرحلة",
  driver_complete_trip:           "إتمام الرحلة",
  driver_cancel_trip:             "إلغاء السائق للرحلة",
  driver_change_trip_time:        "تعديل توقيت الرحلة",
  driver_delete_trip:             "حذف رحلة من السائق",
  delete_trip:                    "حذف رحلة",
  admin_delete_trip:              "حذف رحلة (إداري)",
  admin_cancel_trip_request:      "إلغاء طلب رحلة (إداري)",

  // Reviews
  driver_review_submitted:        "تقييم سائق",
  passenger_review_submitted:     "تقييم راكب",

  // Licenses / verifications
  driver_license_approved:        "قبول رخصة سائق",
  driver_license_rejected:        "رفض رخصة سائق",
  passenger_verification_submitted:"طلب توثيق راكب",

  // Subscriptions / payments
  subscription_requested:         "طلب اشتراك",
  subscription_approved:          "قبول اشتراك",
  subscription_rejected:          "رفض اشتراك",
  subscription_granted:           "منح اشتراك",
  subscription_bulk_granted:      "منح اشتراكات جماعي",
  admin_mark_payment:             "تأكيد دفعة (إداري)",

  // Cities
  city_suggested:                 "اقتراح مدينة",
  city_suggestion_approved:       "قبول اقتراح مدينة",
  city_suggestion_rejected:       "رفض اقتراح مدينة",
  city_added_directly:            "إضافة مدينة مباشرة",

  // Users / moderation
  user_block:                     "حظر مستخدم",
  admin_clear_strikes:            "مسح المخالفات (إداري)",
  admin_update_user:              "تحديث بيانات مستخدم (إداري)",
  onboarding_completed:           "إكمال التسجيل",

  // Reports / feedback
  report_filed:                   "تقديم بلاغ",
  feedback_submitted:             "إرسال شكوى/اقتراح",
};

// Arabic labels for the `target_type` shown in the expanded detail row
// (covers types that appear there as raw strings: trip, booking, user,
// review, report, feedback, city, license, subscription, payment,
// system). Keeps the existing typeConfig.label mapping in sync.
const TARGET_TYPE_LABELS = {
  booking:      "حجز",
  trip:         "رحلة",
  review:       "تقييم",
  user:         "مستخدم",
  feedback:     "اقتراح/شكوى",
  report:       "بلاغ",
  payment:      "دفعة",
  system:       "نظام",
  city:         "مدينة",
  license:      "رخصة",
  subscription: "اشتراك",
};

// Best-effort fallback for an action code we haven't translated yet:
// turn `admin_clear_strikes` into "Admin Clear Strikes". Better than
// nothing while we incrementally fill the dict. The raw code remains
// available in the expanded detail panel for debugging.
function prettifyActionCode(code) {
  if (!code) return "—";
  return String(code)
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatAction(action) {
  if (!action) return "—";
  return ACTION_LABELS[action] || prettifyActionCode(action);
}

function formatTargetType(t) {
  if (!t) return "—";
  return TARGET_TYPE_LABELS[t] || t;
}

// Audit-only type chips — these target_type values only appear in the
// admin-trail RPC, never in the user-activity feed. They were already
// recognised by typeConfig for icon/colour rendering, but couldn't be
// filtered by because no chip existed. Added separately so the activity
// view doesn't surface filters that would always return zero.
const AUDIT_TYPE_FILTERS = [
  { id: "payment", label: "المدفوعات" },
  { id: "system",  label: "النظام" },
];

// View toggle: the existing user-activity feed vs the admin audit trail.
// They use different RPCs and have different schemas — separating them is
// clearer than trying to unify. Activity = "what users did". Audit =
// "what admins / the system did to user records".
const VIEWS = [
  { id: "activity", label: "نشاط المستخدمين" },
  { id: "audit",    label: "سجل الإجراءات الإدارية" },
];

const PAGE_SIZE = 30;

// Format jsonb details for readable expansion. Strings stay as-is, objects
// pretty-print with 2-space indent.
function formatDetails(d) {
  if (!d) return "";
  if (typeof d === "string") return d;
  try { return JSON.stringify(d, null, 2); } catch { return String(d); }
}

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => esc(c.get(r))).join(","))
    .join("\n");
  return header + "\n" + body;
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────────────────
export default function DashboardLogs() {
  const [view, setView] = useState("activity");
  const [filterType, setFilterType] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  // Reset pagination when any filter input changes — otherwise users could
  // be stuck on page 5 of a result set that now only has 2 pages and see
  // an empty list with no obvious cause.
  const resetPage = () => setPage(1);

  // ── Activity feed (user-facing) ────────────────────────────────────────
  // search_email added (migration 050) — admins can now filter the
  // activity feed to a specific user. Accepts an email substring OR
  // a numeric/M-prefixed account number (e.g. 'M-1234' or '1234').
  // Server resolves M-#### to email via profiles.account_number.
  const activityQ = useQuery({
    enabled: view === "activity",
    queryKey: ["activity-log", filterType, searchEmail, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("activity_log", {
        filter_type:     filterType,
        search_email:    searchEmail.trim() || null,
        page_param:      page,
        page_size_param: PAGE_SIZE,
      });
      if (error) throw error;
      return data || { rows: [], total: 0, totalPages: 1 };
    },
  });

  // ── Admin audit trail (rich filters) ───────────────────────────────────
  const auditQ = useQuery({
    enabled: view === "audit",
    queryKey: ["audit-log-search", filterType, searchText, searchEmail, dateFrom, dateTo, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_log_search", {
        filter_type:     filterType,
        search_text:     searchText.trim() || null,
        search_email:    searchEmail.trim() || null,
        date_from:       dateFrom ? new Date(dateFrom).toISOString() : null,
        // For an inclusive end-of-day, push to next day at 00:00 so
        // anything stamped 23:59 still counts.
        date_to:         dateTo ? new Date(new Date(dateTo).getTime() + 24*60*60*1000).toISOString() : null,
        page_param:      page,
        page_size_param: PAGE_SIZE,
      });
      if (error) throw error;
      return data || { rows: [], total: 0, totalPages: 1 };
    },
  });

  // Facets (action names + actor emails) for the filter UI hints.
  const facetsQ = useQuery({
    enabled: view === "audit",
    queryKey: ["audit-log-facets"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_log_facets");
      if (error) throw error;
      return data || { actions: [], actors: [], targetTypes: [] };
    },
    staleTime: 60_000,
  });

  const isLoading = view === "activity" ? activityQ.isLoading : auditQ.isLoading;
  // Surface the query's error so an admin sees real failures (e.g. RPC
  // column-mismatch returning 42703) instead of an empty 'لا توجد نشاطات'
  // state indistinguishable from a legitimately empty feed. Migration 050
  // shipped with cs.user_email that didn't exist; migration 055 fixed it.
  // Without this error branch, the failure was silent for the user.
  const queryError = view === "activity" ? activityQ.error : auditQ.error;
  const data      = view === "activity" ? activityQ.data : auditQ.data;
  const rows       = data?.rows || [];
  const totalLogs  = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const onExport = () => {
    if (view === "activity") {
      const csv = toCsv(rows, [
        { label: "Type",       get: (r) => r.type },
        { label: "Created at", get: (r) => r.created_at },
        { label: "Text",       get: (r) => r.text },
      ]);
      downloadCsv(`activity-log-page${page}.csv`, csv);
    } else {
      const csv = toCsv(rows, [
        { label: "Created at",  get: (r) => r.created_at },
        { label: "Admin email", get: (r) => r.admin_email },
        { label: "Action",      get: (r) => r.action },
        { label: "Target type", get: (r) => r.target_type },
        { label: "Target ID",   get: (r) => r.target_id },
        { label: "Details",     get: (r) => r.details },
      ]);
      downloadCsv(`audit-log-page${page}.csv`, csv);
    }
  };

  const hasFilters = useMemo(() => (
    filterType !== "all" || searchText || searchEmail || dateFrom || dateTo
  ), [filterType, searchText, searchEmail, dateFrom, dateTo]);

  const clearFilters = () => {
    setFilterType("all");
    setSearchText("");
    setSearchEmail("");
    setDateFrom("");
    setDateTo("");
    resetPage();
  };

  return (
    <div>
      {/* View tabs */}
      <div className="flex gap-2 mb-3">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => {
              // If we're leaving audit view while a payment/system chip is
              // active, reset to "all" — those types don't exist in the
              // activity feed, so otherwise the list would silently
              // come back empty.
              const auditOnlyIds = AUDIT_TYPE_FILTERS.map((x) => x.id);
              if (v.id === "activity" && auditOnlyIds.includes(filterType)) {
                setFilterType("all");
              }
              setView(v.id); resetPage(); setExpanded(null);
            }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              view === v.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Filters block */}
      <div className="bg-card border border-border rounded-xl p-3 mb-3 space-y-3">
        {/* Type chips — TYPE_FILTERS always show, AUDIT_TYPE_FILTERS only in
            audit view (those types only appear there). When the user
            switches from audit to activity with a payment/system filter
            selected, fall back to "all" so they're not stuck looking at
            an empty list with no obvious cause. */}
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { setFilterType(f.id); resetPage(); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filterType === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
          {view === "audit" && AUDIT_TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { setFilterType(f.id); resetPage(); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filterType === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Activity view — simple user search (single field).
            Same searchEmail state as the audit view, so switching
            between views preserves the filter. Server-side, the new
            activity_log RPC (migration 050) accepts either an email
            substring or 'M-####' / numeric account ID. */}
        {view === "activity" && (
          <div className="relative max-w-md">
            <Mail className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchEmail}
              onChange={(e) => { setSearchEmail(e.target.value); resetPage(); }}
              placeholder="ابحث بالبريد أو رقم الحساب (M-1234)..."
              className="w-full h-10 pr-10 pl-3 rounded-lg bg-background border border-border text-sm"
            />
          </div>
        )}

        {/* Audit-only rich filters */}
        {view === "audit" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => { setSearchText(e.target.value); resetPage(); }}
                placeholder="بحث في الإجراء أو التفاصيل..."
                className="w-full h-10 pr-10 pl-3 rounded-lg bg-background border border-border text-sm"
              />
            </div>
            <div className="relative">
              <Mail className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchEmail}
                onChange={(e) => { setSearchEmail(e.target.value); resetPage(); }}
                placeholder="بحث ببريد المسؤول..."
                className="w-full h-10 pr-10 pl-3 rounded-lg bg-background border border-border text-sm"
              />
            </div>
            <div className="relative">
              <Calendar className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
                className="w-full h-10 pr-10 pl-3 rounded-lg bg-background border border-border text-sm"
                placeholder="من"
              />
            </div>
            <div className="relative">
              <Calendar className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
                className="w-full h-10 pr-10 pl-3 rounded-lg bg-background border border-border text-sm"
                placeholder="إلى"
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="w-3 h-3" /> مسح الفلاتر
            </button>
          )}
          <div className="mr-auto" />
          <button
            onClick={onExport}
            disabled={!rows.length}
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <Download className="w-3 h-3" /> تصدير CSV
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">
            {view === "activity" ? "سجل النشاطات" : "سجل الإجراءات الإدارية"}
          </h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {totalLogs.toLocaleString("ar")}
          </span>
        </div>
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-10 text-center">
              <div className="w-6 h-6 border-3 border-muted border-t-primary rounded-full animate-spin mx-auto" />
            </div>
          ) : queryError ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-medium text-red-600">تعذر تحميل السجل</p>
              <p className="text-xs text-muted-foreground break-words">
                {queryError?.message || String(queryError)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {queryError?.code ? `code: ${queryError.code}` : null}
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">لا توجد نشاطات</div>
          ) : view === "activity" ? (
            // ───────── User activity rows (existing schema) ─────────
            rows.map((log, i) => {
              const cfg = typeConfig[log.type] || typeConfig.user;
              const Icon = cfg.icon;
              return (
                <div key={`${log.type}-${log.id}-${i}`} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-relaxed">{log.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(log.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${cfg.color}`}>{cfg.label}</span>
                </div>
              );
            })
          ) : (
            // ───────── Audit-trail rows (richer schema, expandable) ─────────
            rows.map((log, i) => {
              const cfg = typeConfig[log.target_type] || typeConfig.system;
              const Icon = cfg.icon;
              const open = expanded === log.id;
              return (
                <div key={log.id || i} className="hover:bg-muted/30 transition-colors">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : log.id)}
                    className="w-full flex items-start gap-3 p-3 text-right"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground font-medium truncate">{formatAction(log.action)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {log.admin_email} · {new Date(log.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${cfg.color}`}>{cfg.label}</span>
                    {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  </button>
                  {open && (
                    <div className="px-3 pb-3 bg-muted/20 border-t border-border">
                      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[11px]">
                        <div>
                          <dt className="text-muted-foreground inline">الإجراء: </dt>
                          <dd className="inline font-medium">
                            {formatAction(log.action)}
                            {ACTION_LABELS[log.action] && (
                              <span className="text-muted-foreground font-normal ml-1" dir="ltr">
                                ({log.action})
                              </span>
                            )}
                          </dd>
                        </div>
                        <div><dt className="text-muted-foreground inline">المستهدف: </dt><dd className="inline">{formatTargetType(log.target_type)} {log.target_id ? `· ${log.target_id}` : ""}</dd></div>
                        <div><dt className="text-muted-foreground inline">المسؤول: </dt><dd className="inline">{log.admin_email}</dd></div>
                        <div><dt className="text-muted-foreground inline">التوقيت: </dt><dd className="inline">{new Date(log.created_at).toLocaleString("ar")}</dd></div>
                      </dl>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <details open className="mt-2">
                          <summary className="text-[11px] text-muted-foreground cursor-pointer">التفاصيل (JSON)</summary>
                          <pre className="text-[10px] bg-card border border-border rounded-md p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-all" dir="ltr">
{formatDetails(log.details)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}

      {/* Facet hints — show top actions/actors as quick filters */}
      {view === "audit" && facetsQ.data && (facetsQ.data.actions?.length > 0 || facetsQ.data.actors?.length > 0) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {facetsQ.data.actions?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="font-bold mb-2 text-foreground">الإجراءات الأكثر تكراراً</p>
              <div className="flex flex-wrap gap-1.5">
                {facetsQ.data.actions.slice(0, 12).map((a) => (
                  <button
                    key={a.action}
                    onClick={() => { setSearchText(a.action); resetPage(); }}
                    className="px-2 py-1 rounded-lg bg-muted/40 hover:bg-muted text-[11px]"
                  >
                    {formatAction(a.action)} <span className="text-muted-foreground">({a.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {facetsQ.data.actors?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="font-bold mb-2 text-foreground">المسؤولون الأكثر نشاطاً</p>
              <div className="flex flex-wrap gap-1.5">
                {facetsQ.data.actors.slice(0, 12).map((a) => (
                  <button
                    key={a.email}
                    onClick={() => { setSearchEmail(a.email); resetPage(); }}
                    className="px-2 py-1 rounded-lg bg-muted/40 hover:bg-muted text-[11px]"
                  >
                    {a.email} <span className="text-muted-foreground">({a.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
