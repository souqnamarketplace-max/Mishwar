import { toast } from "sonner";
import { logAudit } from "@/lib/adminAudit";
import { useSEO } from "@/hooks/useSEO";
import { friendlyError } from "@/lib/errors";
import React, { useState, useEffect, useRef, useMemo } from "react";
import ModalPortal from "@/components/shared/ModalPortal";
import { api } from "@/api/apiClient";
import { isTripExpired, isTripCompleted } from "@/lib/tripScheduling";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifyUser";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Car, MapPin, Clock, Star, Users, ArrowLeft, Download,
  Search, CheckCircle, AlertCircle, XCircle, Navigation, Loader2, Copy, Repeat,
  Briefcase, LayoutDashboard, Trash2, Eye
} from "lucide-react";
import PassengerReviewWizard from "../components/reviews/PassengerReviewWizard";
import { MessageCircle } from "lucide-react";
import MyTripsFilterBar from "@/components/mytrips/MyTripsFilterBar";
import { getDateTileParts } from "@/lib/relativeDate";

const tabs = [
  { id: "all", label: "الكل", icon: Car },
  { id: "confirmed", label: "القادمة", icon: Clock },
  { id: "in_progress", label: "يتم تنفيذها", icon: Navigation },
  { id: "completed", label: "المكتملة", icon: CheckCircle },
  { id: "cancelled", label: "الملغاة", icon: XCircle },
];

const statusConfig = {
  pending:     { label: "بانتظار موافقة السائق", color: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" },
  confirmed:   { label: "مؤكدة",                 color: "bg-accent/10 text-accent border-accent/20" },
  in_progress: { label: "مباشر",                 color: "bg-primary/10 text-primary border-primary/20" },
  completed:   { label: "مكتملة",                color: "bg-muted text-muted-foreground border-border" },
  // The 'cancelled' key was previously defined twice (bg-red-100 then
  // bg-destructive/10). JS uses the second; the first was dead code
  // and the duplication made it look like an inconsistency. Single
  // definition using destructive theme tokens so the badge matches
  // every other 'something failed/was cancelled' surface.
  cancelled:   { label: "ملغاة",                 color: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function MyTrips() {
  useSEO({ title: "رحلاتي", description: "شاهد رحلاتك السابقة والقادمة" });

  const navigate = useNavigate();
  const [confirmCancel, setConfirmCancel] = useState({ open: false, bookingId: null, reason: "" });
  const [selectedTrips, setSelectedTrips] = useState(new Set()); // For bulk delete
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, tripId: null, isBulk: false });

  // Helper functions for trip selection
  const toggleTripSelection = (tripId) => {
    setSelectedTrips(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tripId)) {
        newSet.delete(tripId);
      } else {
        newSet.add(tripId);
      }
      return newSet;
    });
  };

  const selectAllCancelled = (cancelledTrips) => {
    setSelectedTrips(new Set(cancelledTrips.map(t => t.id)));
  };

  const clearSelection = () => {
    setSelectedTrips(new Set());
  };
  const [searchParams] = useSearchParams();
  // Read the tab from the URL on initial render so deep-links from
  // notifications work: '/my-trips?tab=confirmed' lands on the upcoming
  // tab, '/my-trips?tab=cancelled' on the cancelled tab. Validate
  // against the known tab list so a malformed param falls back to
  // 'all' rather than rendering an empty page.
  const _validTabIds = tabs.map(t => t.id);
  const _paramTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    _validTabIds.includes(_paramTab) ? _paramTab : "all"
  );
  // Role filter — only meaningful when the user is "both" (account_type
  // 'both' means they post AS DRIVER and book AS PASSENGER). Mixing
  // both kinds of trips in a single list was confusing per user
  // feedback: "this page is confusing when the user has driver and
  // passenger". Now we offer:
  //   - "all":       both kinds shown together, split into two sections
  //   - "driver":    only trips the user is driving
  //   - "passenger": only trips the user has booked as a passenger
  // For pure passengers / pure drivers, this state is silently
  // ignored (the toggle UI is not rendered, no filter is applied).
  // Persisted in URL as ?role= so cross-app deep-links can target
  // a specific role view, e.g. /my-trips?role=passenger from the
  // account-deletion blocker banner.
  const _paramRole = searchParams.get("role");
  const _validRoleIds = ["all", "driver", "passenger"];
  const [roleFilter, setRoleFilter] = useState(
    _validRoleIds.includes(_paramRole) ? _paramRole : "all"
  );
  const [wizardTrip, setWizardTrip] = useState(null); // trip object for PassengerReviewWizard

  // ── Filter state (lifted from MyTripsFilterBar) ─────────────────────
  // All five filter values feed the react-query keys below so changing
  // any of them triggers a refetch with the new criteria. Empty string
  // = filter inactive. Date strings are YYYY-MM-DD to match the
  // trips.date column format (which is plain text date, not timestamp).
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [routeFrom,  setRouteFrom]  = useState("");
  const [routeTo,    setRouteTo]    = useState("");
  // Convenience: are any filters active? Drives the "no results match"
  // vs "you have no trips" empty-state distinction below.
  const anyFilterActive = Boolean(
    searchTerm.trim() || dateFrom || dateTo || routeFrom || routeTo
  );

  const qc = useQueryClient();
  const highlightTripId = searchParams.get("trip");
  const highlightRef = useRef(null);

  // Auto-scroll to highlighted trip after data loads
  useEffect(() => {
    if (highlightTripId && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 600);
    }
  }, [highlightTripId]);

  // Cancel booking mutation (for passenger bookings)
  const cancelBookingMutation = useMutation({
    mutationFn: async (input) => {
      // Accept either the legacy bookingId-only signature or { bookingId, reason }
      // so the UI can pass an optional human-readable cancellation reason that
      // gets persisted alongside the status flip. Old callers that pass just an
      // id keep working — reason just stays null in that case.
      const bookingId = typeof input === "string" ? input : input?.bookingId;
      const reason = typeof input === "string" ? null : (input?.reason || null);
      // Route through the cancel_booking RPC (migration 018) so seat
      // refund, authorization, and late-cancellation strikes happen
      // atomically server-side. The previous implementation did a
      // direct supabase.from("bookings").update({status:'cancelled'})
      // and the comment claimed "Seat restoration is handled by the
      // bookings_restore_seats DB trigger" — but NO such trigger has
      // ever shipped (verified: zero hits in migrations/ and the
      // public schema file). So this surface was the third site
      // leaking seats: passengers cancelling from /my-trips left
      // their trip's available_seats stuck at the lower count, and
      // the strike system never ran for late cancellations from
      // here either. Now matches the pattern used in
      // apiClient.cancelBooking and DriverPassengers.
      const { error: rpcErr } = await supabase.rpc("cancel_booking", {
        booking_id_param: bookingId,
        reason_param: reason || "passenger_self_cancel",
      });
      if (rpcErr) throw rpcErr;
      return { success: true };
    },
    onSuccess: async (_, input) => {
      const bookingId = typeof input === "string" ? input : input?.bookingId;
      // Caches that the cancel must invalidate, by where the user is
      // likely to go next after seeing "تم إلغاء الحجز بنجاح":
      //
      //   ["my-passenger-bookings"] — this page's own list, so the row
      //     drops into the "Cancelled" tab immediately.
      //   ["my-booking"] — TripDetails reads this PER (trip, email)
      //     pair to decide between "Book this trip" and the
      //     "waiting for driver approval" pill. Invalidated by
      //     prefix so every variant (any trip id) refetches; the
      //     user may navigate to a different trip than the one
      //     they just left. WITHOUT this, react-query's default
      //     staleTime kept the cancelled booking visible as
      //     "pending approval" for ~1 minute, blocking re-booking —
      //     exactly the bug souqnamarketplace@gmail.com hit when
      //     trying to re-book Ramallah → Nablus right after
      //     cancelling.
      //   ["trip", *] and ["trips"] / ["my-booked-trips"] — the
      //     server-side cancel_booking RPC refunds the seat
      //     atomically, so available_seats changed; the trip detail
      //     and any trip-list view (search, my-trips driver tab)
      //     would otherwise show the old (lower) seat count until
      //     their own staleTime expired.
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-booking"] });
      qc.invalidateQueries({ queryKey: ["trip"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["my-booked-trips"] });
      logAudit("booking_cancelled_by_passenger", "booking", bookingId, { passenger_email: user?.email });
      toast.success("تم إلغاء الحجز بنجاح");
      // Notify driver that the booking was cancelled. Routes through
      // notifyUser → create_notification RPC (migration 027) so the
      // cross-user insert clears the migration 002 RLS check via Rule D
      // (caller and target share a booking on a trip). Previously this
      // hit notifications_insert directly and the RLS rejection was
      // silently swallowed by the catch block — drivers never actually
      // got the bell ping when a passenger self-cancelled.
      try {
        const booking = passengerBookings?.find(b => b.id === bookingId);
        const trip = allTrips?.find(t => t.id === booking?.trip_id);
        if (trip?.driver_email && user?.email) {
          await notifyUser({
            user_email: trip.driver_email,
            title: "تم إلغاء حجز على رحلتك",
            message: `${user.full_name || user.email} ألغى حجزه في رحلتك من ${trip.from_city} إلى ${trip.to_city}`,
            type: "system",
            trip_id: trip.id,
            // Driver lands on the passenger-management tab of their
            // dashboard — where they can see who's left, message the
            // remaining riders, mark the trip cancelled if it's now
            // empty, etc. The previous link '/my-trips?tab=driver'
            // pointed to a tab that doesn't exist in MyTrips (only
            // 'all/confirmed/in_progress/completed/cancelled' are
            // valid) so the deep-link silently fell back to 'all'
            // and the driver had to manually navigate to find the
            // cancellation. Bug since ~mig 027; fixed in the full
            // notification audit (this commit).
            link: "/driver?tab=passengers",
          });
        }
      } catch (e) { console.warn("[Notif] booking_cancelled:", e?.message); }
    },
    onError: (err) => toast.error(friendlyError(err, "فشل إلغاء الحجز")),
  });

  // Delete cancelled trips mutation
  const deleteTripMutation = useMutation({
    mutationFn: async (tripIds) => {
      // Accept single trip ID or array of IDs for bulk delete
      const ids = Array.isArray(tripIds) ? tripIds : [tripIds];
      const results = await Promise.allSettled(
        ids.map(id => supabase.rpc("delete_cancelled_trip", { p_trip_id: id }))
      );
      
      const failures = results.filter(r => r.status === "rejected");
      if (failures.length > 0 && failures.length === ids.length) {
        // All failed
        throw new Error(failures[0].reason?.message || "فشل حذف الرحلات");
      }
      
      return { 
        success: results.filter(r => r.status === "fulfilled").length,
        failed: failures.length,
        total: ids.length
      };
    },
    onSuccess: (result) => {
      // Invalidate trip caches
      qc.invalidateQueries({ queryKey: ["my-booked-trips"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      
      // Clear selection
      setSelectedTrips(new Set());
      setDeleteConfirm({ open: false, tripId: null, isBulk: false });
      
      // Success message
      if (result.failed > 0) {
        toast.success(`تم حذف ${result.success} من ${result.total} رحلة`);
      } else {
        toast.success(result.total === 1 ? "تم حذف الرحلة" : `تم حذف ${result.total} رحلات`);
      }
    },
    onError: (err) => {
      toast.error(friendlyError(err, "فشل حذف الرحلة"));
      setDeleteConfirm({ open: false, tripId: null, isBulk: false });
    },
  });

  const { user } = useAuth();

  // Role detection — passengers don't have driver trips, drivers may not have bookings
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";
  // 'both' specifically — drives whether we render the role-filter toggle.
  // Pure drivers / pure passengers don't see it (the filter would be a
  // no-op for them since they only ever have one kind of row).
  const isBoth = user?.account_type === "both";

  // Page size for both driver-trips and passenger-bookings pagination.
  // 25 hits the sweet spot for mobile: small enough to render fast,
  // big enough that most users see everything without paging.
  const PAGE_SIZE = 25;

  // ── Driver trips with server-side pagination + filtering ────────────
  // useInfiniteQuery replaces the flat .filter(..., 50) so heavy drivers
  // (50+ trips) can actually see their full history. paginate() under
  // the hood is `range()` with count: 'exact', returning { rows, total,
  // totalPages, page } — exactly what useInfiniteQuery expects when paired
  // with getNextPageParam.
  //
  // The queryKey includes every filter value, so changing any of them
  // resets pagination and re-fetches from page 1 (standard react-query
  // behavior — different key, fresh cache entry).
  //
  // Filters applied SERVER-SIDE:
  //   - driver_email = current user (always)
  //   - status = activeTab (when not "all") — uses idx_trips_driver_created
  //     for the driver_email seek, then filters status from those rows
  //   - from_city / to_city — exact city match via .eq()
  //   - date range — gte/lte on the date column (YYYY-MM-DD lexical compare)
  //   - searchTerm — ilike across from_city + to_city
  const driverTripsInf = useInfiniteQuery({
    queryKey: ["my-driver-trips", user?.email, activeTab, searchTerm, dateFrom, dateTo, routeFrom, routeTo],
    queryFn: ({ pageParam = 1 }) => api.entities.Trip.paginate({
      page: pageParam,
      pageSize: PAGE_SIZE,
      sort: "-created_date",
      conditions: {
        driver_email: user.email,
        // Only constrain status when a specific tab is active. The "all"
        // tab keeps every status in the result set so the grouping logic
        // below can render multiple sections from one query.
        ...(activeTab !== "all" && { status: activeTab }),
        ...(routeFrom ? { from_city: routeFrom } : {}),
        ...(routeTo   ? { to_city:   routeTo   } : {}),
      },
      dateColumn: "date",
      dateFrom: dateFrom || null,
      dateTo:   dateTo   || null,
      searchTerm: searchTerm.trim() || null,
      searchColumns: ["from_city", "to_city"],
    }),
    initialPageParam: 1,
    // Stop paginating once we've consumed all pages. paginate() returns
    // totalPages computed from `count`, so this is exact.
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: !!user?.email && isDriver,
  });

  // Flatten all loaded pages into a single array. trips render order is
  // newest-created first (server sort), preserved by Array.prototype.flat.
  const driverTrips    = driverTripsInf.data?.pages.flatMap(p => p.rows) || [];
  const driverTotal    = driverTripsInf.data?.pages[0]?.total ?? 0;
  const driverTripsLoading = driverTripsInf.isLoading;

  // For passengers, isLoading is governed by passenger booking + allTrips queries
  const isLoading = isDriver ? driverTripsLoading : false;

  // ── Passenger bookings — also paginated for symmetry ────────────────
  // Bookings don't carry route/date info themselves — those live on the
  // associated trip row. So filters can't be applied to this query
  // server-side. Instead we paginate by booking date and apply
  // route/date/search filters to the trips fetch below.
  //
  // This is fine UX-wise because the trip filter is what users actually
  // care about ("trips to Bethlehem"), not "bookings made in March". If
  // a user wants to find an old booking, they bump the page count up.
  const passengerBookingsInf = useInfiniteQuery({
    queryKey: ["my-passenger-bookings", user?.email, activeTab],
    queryFn: ({ pageParam = 1 }) => api.entities.Booking.paginate({
      page: pageParam,
      pageSize: PAGE_SIZE,
      sort: "-created_date",
      conditions: {
        passenger_email: user.email,
        // Bookings have their own status column. When user clicks "confirmed",
        // they want trips where their booking is confirmed (regardless of
        // whether the driver subsequently cancelled the whole trip).
        ...(activeTab !== "all" && { status: activeTab }),
      },
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: !!user?.email,
  });

  const passengerBookings = passengerBookingsInf.data?.pages.flatMap(p => p.rows) || [];
  const passengerTotal    = passengerBookingsInf.data?.pages[0]?.total ?? 0;

  // Trips the user has booked. Previously this fetched the PLATFORM's
  // 200 newest trips (`api.entities.Trip.list("-created_date", 200)`)
  // and tried to look up the user's bookings within that pool — which
  // meant any trip older than the latest 200 platform trips was
  // silently missing. Once Mishwaro has a few hundred users posting
  // daily, a user's confirmed booking from a week ago would just
  // disappear from /my-trips. They'd think their booking was cancelled.
  //
  // Fix: query only the trip ids the user has bookings on, using
  // Booking.trip_id as an .in() filter. This makes every booking
  // visible regardless of trip age AND drastically reduces bandwidth
  // (1 trip per booking instead of 200 unrelated ones).
  //
  // FILTERS: applied here so passenger trips also get the date/route
  // filter behavior. Since we already do an `.in(id, [...])` query,
  // adding `.gte/lte` and `.eq` is a free piggyback that the trips_pkey
  // index uses for the .in() seek and the planner adds the others as
  // bitmap-and clauses.
  const myBookedTripIds = (passengerBookings || []).map(b => b.trip_id).filter(Boolean);
  const { data: allTrips = [] } = useQuery({
    queryKey: [
      "my-booked-trips",
      user?.email,
      myBookedTripIds.join(","),
      dateFrom, dateTo, routeFrom, routeTo, searchTerm,
    ],
    queryFn: async () => {
      if (myBookedTripIds.length === 0) return [];
      let q = supabase.from("trips").select("*").in("id", myBookedTripIds);
      if (dateFrom)  q = q.gte("date", dateFrom);
      if (dateTo)    q = q.lte("date", dateTo);
      if (routeFrom) q = q.eq("from_city", routeFrom);
      if (routeTo)   q = q.eq("to_city",   routeTo);
      if (searchTerm.trim()) {
        // Escape any chars that would break Supabase's .or() syntax,
        // matching the apiClient.paginate() escape rules.
        const escaped = searchTerm.trim().replace(/[%,()]/g, " ");
        q = q.or(`from_city.ilike.%${escaped}%,to_city.ilike.%${escaped}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email && myBookedTripIds.length > 0,
  });

  // Group passenger bookings by trip_id, picking the most relevant booking
  // per trip. The whole booking object is stored (not just b.status) so the
  // card renderer can read cancellation_reason and show 'cancelled by you'
  // vs 'cancelled by driver'.
  //
  // Selection rule: prefer the NEWEST non-cancelled booking if one exists
  // (handles the cancel-then-rebook case — the user should see the active
  // re-booking, not the older cancelled row). If a trip has ONLY cancelled
  // bookings, the newest cancelled one wins and the trip shows up in the
  // الملغاة tab.
  //
  // Previously this filtered cancelled bookings out entirely (the old
  // `activePassengerBookings` variable), which made the الملغاة tab
  // permanently empty for passengers — the tab existed but no row would
  // ever populate it because cancelled bookings were stripped before the
  // tab logic ever ran. Bug report from prod: user cancelled a pending
  // booking, looked in الملغاة, saw "لا توجد رحلات".
  const bookingByTripId = new Map();
  for (const b of (passengerBookings || [])) {
    // passengerBookings is sorted -created_date desc, so first hit per
    // trip is the newest. Replace only if we previously stored a
    // cancelled booking and we now find an active one — that handles
    // the (rare) case where the sort order isn't strictly newest-first.
    const existing = bookingByTripId.get(b.trip_id);
    if (!existing) {
      bookingByTripId.set(b.trip_id, b);
    } else if (existing.status === "cancelled" && b.status !== "cancelled") {
      bookingByTripId.set(b.trip_id, b);
    }
  }
  // Merge: driver trips + trips the user has any booking on (deduplicated)
  const bookedTripIds = new Set(bookingByTripId.keys());
  const bookedTrips = allTrips.filter(t => bookedTripIds.has(t.id));
  const trips = [...driverTrips, ...bookedTrips.filter(t => !driverTrips.find(dt => dt.id === t.id))];

  // Real-time subscription for trip & review updates
  useEffect(() => {
    const unsubTrips = api.entities.Trip.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    });
    const unsubReviews = api.entities.Review.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["my-reviews"] });
    });
    // KEY FIX: when driver confirms/cancels a booking, passenger sees it instantly
    const unsubBookings = api.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-booked-trips"] });
      qc.invalidateQueries({ queryKey: ["my-driver-trips"] });
    });
    return () => { unsubTrips(); unsubReviews(); unsubBookings(); };
  }, [qc]);

  // For passenger trips, the BOOKING status takes precedence over trip status.
  // For driver trips (no booking on user's behalf), fall back to the trip status.
  // Driver-of-trip takes precedence over passenger-on-trip — the latter shouldn't
  // happen (book_seat refuses to let a driver book their own trip) but is harmless
  // to handle. Returns the booking's status when there is one, otherwise the
  // trip's own status.
  const effectiveStatus = (t) => {
    if (driverTrips.find(dt => dt.id === t.id)) return t.status;
    return bookingByTripId.get(t.id)?.status || t.status;
  };
  // Trip-role classifier — drives the per-card badge AND the role
  // filter. driverTrips IDs are the authoritative "user is the
  // driver" signal; everything else with a booking is a passenger
  // ride. The book_seat RPC refuses driver-books-own-trip so these
  // are mutually exclusive in practice.
  const driverTripIdSet = useMemo(() => new Set(driverTrips.map(t => t.id)), [driverTrips]);
  const tripRole = (t) => (driverTripIdSet.has(t.id) ? "driver" : "passenger");

  // Filter pipeline:
  //   1. Role filter (only active when user is 'both' AND chose
  //      something other than 'all') — drops the opposite-role rows
  //   2. Status filter (existing tabs) — drops rows not matching
  //      the selected status
  //
  // The order matters for the per-tab counts shown in the empty
  // state ("you have rows in OTHER tabs"): we want to count within
  // the current role view, not across both roles.
  const roleFiltered = (isBoth && roleFilter !== "all")
    ? trips.filter(t => tripRole(t) === roleFilter && !t.deleted_at)
    : trips.filter(t => !t.deleted_at);
  const filtered = activeTab === "all"
    ? roleFiltered
    : roleFiltered.filter((t) => effectiveStatus(t) === activeTab);
  const { data: myReviews = [] } = useQuery({
    queryKey: ["my-reviews", user?.email],
    queryFn: () => api.entities.Review.filter({ reviewer_email: user?.email, review_type: "passenger_rates_driver" }),
    enabled: !!user?.email,
  });
  const reviewedTripIds = new Set(myReviews.map((r) => r.trip_id));

  const grouped = {
    pending: filtered.filter((t) => effectiveStatus(t) === "pending"),
    confirmed: filtered.filter((t) => effectiveStatus(t) === "confirmed"),
    in_progress: filtered.filter((t) => effectiveStatus(t) === "in_progress"),
    completed: filtered.filter((t) => effectiveStatus(t) === "completed"),
    cancelled: filtered.filter((t) => effectiveStatus(t) === "cancelled"),
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Car className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">رحلاتي</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {/* Total counts surfaced inline with the page subtitle so users
              know how many rows they have without scrolling. driverTotal
              and passengerTotal come from paginate()'s count: 'exact'. */}
          {isDriver && driverTotal > 0 && (
            <span className="inline-block mx-1">
              {driverTotal} رحلة كسائق
            </span>
          )}
          {isDriver && driverTotal > 0 && passengerTotal > 0 && <span>·</span>}
          {passengerTotal > 0 && (
            <span className="inline-block mx-1">
              {passengerTotal} حجز كراكب
            </span>
          )}
          {driverTotal === 0 && passengerTotal === 0 && (
            <span>جميع رحلاتك الحالية والسابقة في مكان واحد</span>
          )}
        </p>

        {/* Recurring trips entry — only shown to drivers (passengers
            can't create trips). Subtle inline link rather than a
            prominent CTA — this is a power-feature for regulars,
            not a first-time-user nudge. */}
        {isDriver && (
          <button
            onClick={() => navigate("/recurring-trips")}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline px-3 py-2 min-h-[44px]"
          >
            <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
            إدارة الرحلات المتكررة
          </button>
        )}
      </div>

      {/* Active-bookings banner — discovery aid for passengers who
          have confirmed/pending bookings they may want to cancel.
          Without this banner, the cancel buttons live at the bottom
          of each card and are easy to miss on mobile. Users who
          tried to delete their account and got blocked specifically
          for active bookings need to land here and immediately
          know "where do I cancel these?". The banner is dismissible
          (data-driven from the count, not localStorage) and links
          to the القادمة tab where active bookings live. */}
      {(() => {
        const cancellableCount = (passengerBookings || []).filter(
          b => b.status === "confirmed" || b.status === "pending"
        ).length;
        if (cancellableCount === 0) return null;
        if (activeTab === "confirmed") return null; // already filtered to them
        return (
          <div className="mb-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 flex items-start gap-3" dir="rtl">
            <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
              <span className="text-lg" aria-hidden="true">ℹ️</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900">
                لديك {cancellableCount} {cancellableCount === 1 ? "حجز نشط" : "حجوزات نشطة"}
              </p>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                لإلغاء حجز، اضغط زر «إلغاء الحجز» الأحمر الموجود في بطاقة الرحلة بالأسفل.
              </p>
              <button
                onClick={() => setActiveTab("confirmed")}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 active:bg-amber-300 border border-amber-300 rounded-lg px-3 py-2 min-h-[36px] transition-colors"
              >
                اعرض الحجوزات النشطة فقط
              </button>
            </div>
          </div>
        );
      })()}

      {/* Filter bar — collapsible, contains free-text search + date range +
          route from/to. Renders above the status tabs so users filter
          BEFORE picking a status. Filter changes auto-reset pagination
          (queryKey includes all filter values). */}
      <MyTripsFilterBar
        searchTerm={searchTerm}   setSearchTerm={setSearchTerm}
        dateFrom={dateFrom}       setDateFrom={setDateFrom}
        dateTo={dateTo}           setDateTo={setDateTo}
        routeFrom={routeFrom}     setRouteFrom={setRouteFrom}
        routeTo={routeTo}         setRouteTo={setRouteTo}
      />

      {/* ─── Role selector — primary navigation for 'both' users ─────
          Replaces the older small chip-row. User feedback: "this page
          is not designed well and confusing when the account has both
          driver and passenger". The fix is to make role separation
          PRIMARY (not secondary to status). Each option is a tall
          card with icon + label + count, selected state has a
          colored background + shadow that makes the active view
          unmistakable at a glance.

          Three options:
            🚗 الكل    — combined view, no role filter
            🚗 كسائق   — only driver trips
            🧳 كراكب   — only passenger bookings

          Only renders when isBoth. Pure passengers/drivers have a
          single-role list and don't need this. */}
      {isBoth && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              عرض النشاط
            </p>
            {/* Quick-link back to driver dashboard — both users
                spend most of their time on /driver managing posts.
                Always-visible escape hatch when they're done
                browsing /my-trips. */}
            <Link
              to="/driver"
              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              لوحة السائق
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { id: "all",       label: "الكل",   icon: Car,       count: driverTotal + passengerTotal, color: "primary" },
              { id: "driver",    label: "كسائق",  icon: Car,       count: driverTotal,                  color: "primary" },
              { id: "passenger", label: "كراكب",  icon: Briefcase, count: passengerTotal,               color: "amber" },
            ].map((opt) => {
              const isActive = roleFilter === opt.id;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRoleFilter(opt.id)}
                  className={`flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-2xl border-2 transition-all min-h-[80px] ${
                    isActive
                      ? opt.color === "amber"
                        ? "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/20"
                        : "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20"
                      : "bg-card border-border text-foreground hover:bg-muted active:scale-[0.98]"
                  }`}
                  aria-pressed={isActive}
                >
                  <Icon className={`w-5 h-5 ${isActive ? "" : opt.color === "amber" ? "text-amber-500" : "text-primary"}`} aria-hidden="true" />
                  <span className="text-sm font-bold">{opt.label}</span>
                  <span className={`text-xs ${isActive ? "opacity-90" : "text-muted-foreground"}`}>
                    {opt.count} {opt.id === "driver" ? "رحلة" : opt.id === "passenger" ? "حجز" : "العدد"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* For pure DRIVERS — same quick-link to dashboard but inline
          (they don't see the role selector above). Visible only on
          /my-trips so they remember where to go for active management. */}
      {isDriver && !isBoth && (
        <div className="mb-4 flex justify-end">
          <Link
            to="/driver"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 text-xs font-bold text-primary min-h-[40px]"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            لوحة السائق ←
          </Link>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl border p-6 animate-pulse">
              <div className="h-5 bg-muted rounded w-48 mb-3" />
              <div className="h-4 bg-muted rounded w-32" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        // Distinguish "you have NO trips at all" from "you have trips but
        // none match the current tab filter". The previous copy
        // ("لا توجد رحلات / ابدأ بنشر رحلة") was misleading for the
        // second case — drivers with active confirmed trips would see
        // a "no trips, start posting!" state when they tapped "completed"
        // before they had any completed ones. Same UX pattern shipped
        // for /passenger-requests in commit 780db6d.
        //
        // Filter case (added in mig 074 frontend): when filters are active
        // and zero rows match, show a "no results for your filters" empty
        // state with a "مسح الفلاتر" action — distinct from "you have no
        // trips at all" which would suggest creating a new trip.
        anyFilterActive ? (
          <div className="text-center py-16">
            <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-bold text-foreground mb-1">لا توجد نتائج تطابق الفلاتر</h3>
            <p className="text-xs text-muted-foreground mb-3">
              جرّب توسيع نطاق التاريخ أو إزالة فلتر المسار.
            </p>
            <button
              onClick={() => {
                setSearchTerm(""); setDateFrom(""); setDateTo("");
                setRouteFrom(""); setRouteTo("");
              }}
              className="text-sm text-primary hover:underline font-medium"
            >
              مسح كل الفلاتر
            </button>
          </div>
        ) : trips.length > 0 ? (
          <div className="text-center py-16">
            <Car className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-bold text-foreground mb-1">لا توجد رحلات في هذا التبويب</h3>
            <p className="text-xs text-muted-foreground">
              لديك رحلات في تبويبات أخرى — جرّب &ldquo;الكل&rdquo; لرؤيتها جميعاً.
            </p>
          </div>
        ) : (
        <div className="text-center py-20">
          <Car className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {isDriver
              ? "ابدأ بنشر رحلة أو ابحث عن رحلة كراكب"
              : "ابحث عن رحلة، أو اطلب من السائقين أن يأخذوك إلى وجهتك"}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/search"><Button className="rounded-xl">ابحث عن رحلة</Button></Link>
            {isDriver ? (
              <Link to="/create-trip"><Button variant="outline" className="rounded-xl">أنشر رحلة</Button></Link>
            ) : (
              <Link to="/request-trip"><Button variant="outline" className="rounded-xl">اطلب رحلة</Button></Link>
            )}
          </div>
          {/* Always surface "طلباتي" so users can find existing requests
              even if they have no trips. */}
          <Link to="/my-requests" className="inline-block text-xs text-muted-foreground hover:text-primary mt-4 underline">
            عرض طلبات الرحلات الخاصة بي ←
          </Link>
        </div>
        )
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([status, statusTrips]) => {
            if (statusTrips.length === 0) return null;
            const config = statusConfig[status];
            return (
              <div key={status}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    {config?.label || status}
                    <span className="text-sm font-normal text-muted-foreground">({statusTrips.length})</span>
                  </h3>
                  
                  {/* Bulk delete controls for cancelled trips */}
                  {status === "cancelled" && statusTrips.length > 0 && (
                    <div className="flex items-center gap-2">
                      {selectedTrips.size > 0 ? (
                        <>
                          <span className="text-sm text-muted-foreground">
                            {selectedTrips.size} محددة
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={clearSelection}
                          >
                            إلغاء التحديد
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteConfirm({ open: true, tripId: null, isBulk: true })}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            حذف المحددة
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => selectAllCancelled(statusTrips)}
                        >
                          تحديد الكل
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {statusTrips.map((trip) => {
                    // Role classification — drives the top-strip color
                    // + label. ONLY shown for 'both' users; pure
                    // drivers / passengers don't need it (their whole
                    // list is one role). Previously this was a faint
                    // right border + tiny corner pill, which the user
                    // reported as still confusing. Now it's a full-
                    // width strip at the top of every card — same
                    // pattern used by airline/email apps to label
                    // categories ("Inbox" / "Spam" / "Promotions").
                    const role = tripRole(trip);
                    const showRoleStrip = isBoth;
                    const isCancelled = status === "cancelled";
                    const isSelected = selectedTrips.has(trip.id);
                    
                    return (
                    <div
                      key={trip.id}
                      ref={trip.id === highlightTripId ? highlightRef : null}
                      className={`rounded-2xl transition-all duration-700 ${
                        trip.id === highlightTripId
                          ? "ring-2 ring-primary ring-offset-2 shadow-lg shadow-primary/20"
                          : ""
                      }`}
                    >
                      {/* Delete controls for cancelled trips */}
                      {isCancelled && (
                        <div className="flex items-center justify-between mb-2 px-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleTripSelection(trip.id)}
                              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-muted-foreground">تحديد</span>
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.preventDefault();
                              setDeleteConfirm({ open: true, tripId: trip.id, isBulk: false });
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            حذف
                          </Button>
                        </div>
                      )}
                      <Link to={`/trip/${trip.id}`}>
                        <div className="bg-card rounded-2xl border border-border overflow-hidden hover:shadow-md transition-all">
                          {/* Top role strip — clear, prominent role
                              indicator that runs the full width of the
                              card header. Green for driver, amber for
                              passenger. Includes icon + label so the
                              role reads even on a quick scan. */}
                          {showRoleStrip && (
                            <div
                              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold ${
                                role === "driver"
                                  ? "bg-primary/10 text-primary border-b border-primary/20"
                                  : "bg-amber-50 text-amber-900 border-b border-amber-200"
                              }`}
                            >
                              {role === "driver" ? (
                                <>
                                  <Car className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>أنت السائق في هذه الرحلة</span>
                                </>
                              ) : (
                                <>
                                  <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>حجزت كراكب في هذه الرحلة</span>
                                </>
                              )}
                            </div>
                          )}
                          <div className="p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            {/* Date tile — was previously broken: called
                                trip.date?.split(" ")[0] / [1] on an ISO
                                string like "2026-05-16", which returns
                                the WHOLE string for [0] and undefined
                                for [1] (no space to split on). Fallbacks
                                kicked in and users saw stale placeholders.
                                Now uses getDateTileParts from the shared
                                relative-date lib so the tile reads:
                                  - "اليوم" / "غداً" / "بعد غد" for near
                                  - weekday name for 3-6 days out
                                  - "DD MonthName" for further out
                                with the day number and time underneath. */}
                            {(() => {
                              const parts = getDateTileParts(trip.date);
                              const topLabel = parts?.weekday || "—";
                              const bigNumber = parts?.day != null ? parts.day : "—";
                              const time = trip.time || "—";
                              return (
                                <div className="text-center bg-muted/50 rounded-xl px-4 py-3 shrink-0">
                                  <p className="text-xs text-muted-foreground">{topLabel}</p>
                                  <p className="text-2xl font-bold text-foreground">{bigNumber}</p>
                                  <p className="text-xs text-muted-foreground">{time}</p>
                                </div>
                              );
                            })()}
                            {/* Car thumbnail — only renders when the trip has a
                                car_image. Reinforces visual identity of the
                                vehicle and matches what TripCard / TripDetails
                                already show, so users see consistent imagery. */}
                            {trip.car_image && (
                              <div className="w-20 h-14 rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-border/40">
                                <img
                                  loading="lazy"
                                  decoding="async"
                                  src={trip.car_image}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 font-bold text-foreground mb-1 flex-wrap">
                                <MapPin className="w-4 h-4 text-primary" />
                                <span>{trip.from_city}</span>
                                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                                <span>{trip.to_city}</span>
                                {driverTrips.find(dt => dt.id === trip.id) ? (
                                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">🚗 أنت السائق</span>
                                ) : (
                                  <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">🎫 أنت راكب</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Users className="w-3.5 h-3.5" />
                                  {trip.available_seats} مقاعد
                                </span>
                                <span className="flex items-center gap-1">
                                  <Star className="w-3.5 h-3.5 text-yellow-500" />
                                  {trip.driver_rating || "4.5"}
                                </span>
                              </div>
                              {/* Cancellation attribution. Shown only when the
                                  trip lands in the cancelled tab — the booking
                                  row's cancellation_reason tells us who
                                  triggered it. Values come from the three
                                  cancel call-sites:
                                    'passenger_self_cancel' → MyTrips.jsx (this file, cancelBookingMutation)
                                    'driver_cancel'         → DriverPassengers.jsx
                                    'driver_reject_popup'   → BookingRequestPopup.jsx
                                  Driver-side trip cancellation (trip.status=
                                  'cancelled' without a passenger-booking
                                  context) falls through to the generic
                                  'ألغيت' text. */}
                              {status === "cancelled" && (() => {
                                const booking = bookingByTripId.get(trip.id);
                                const reason = booking?.cancellation_reason;
                                const isDriverTrip = !!driverTrips.find(dt => dt.id === trip.id);
                                let label;
                                if (isDriverTrip) {
                                  label = "ألغيت من قِبلك";
                                } else if (reason === "passenger_self_cancel") {
                                  label = "ألغيتَ هذا الحجز";
                                } else if (reason === "driver_cancel") {
                                  label = "ألغاه السائق";
                                } else if (reason === "driver_reject_popup") {
                                  label = "رفض السائق طلبك";
                                } else if (reason === "auto_expired_no_driver_response") {
                                  // Auto-cancelled because the trip departure
                                  // passed with the booking still pending —
                                  // migration 045 lazy-expires these. From
                                  // the passenger's POV, the driver never
                                  // responded and the trip is gone.
                                  label = "انتهت مهلة الرد من السائق";
                                } else {
                                  // Unknown / legacy reason — show neutral text
                                  label = "ملغاة";
                                }
                                return (
                                  <p className="mt-1 text-xs text-destructive/80 font-medium">
                                    {label}
                                  </p>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge className={config?.color}>{config?.label}</Badge>
                              {trip.view_count > 0 && (
                                <div className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>{trip.view_count}</span>
                                </div>
                              )}
                              <span className="text-xl font-bold text-primary">₪{trip.price}</span>
                            </div>
                          </div>
                          </div>
                        </div>
                      </Link>

                      
                      {status === "confirmed" && trip.driver_phone && (
                        <div className="mt-2 px-1">
                          
                        </div>
                      )}

                      {/* Cancel + Message driver buttons for confirmed/in_progress passenger trips.
                          UX FIX: cancel-booking used to be a tiny underlined
                          text link sitting next to "راسل السائق". Users
                          consistently missed it on mobile — the visual
                          weight matched the inline message link, not a
                          destructive action. Fix:
                            - Stacks the two buttons vertically on mobile so
                              the cancel button has its own full-width row
                              (easier tap target, no fighting for the same
                              horizontal space).
                            - Cancel becomes a proper bordered destructive
                              button (matches DriverTripsList cancel pattern)
                              with explicit padding (py-2.5) ensuring ≥44pt
                              touch target.
                            - Message-driver remains as a primary chip-style
                              link so it visually splits from cancel. */}
                      {(status === "confirmed" || status === "in_progress" || status === "pending") && bookedTripIds.has(trip.id) && (
                        <div className="mt-3 px-1 flex flex-col sm:flex-row gap-2">
                          {/* Message driver — chip style, primary color */}
                          <Link
                            to={`/messages?to=${encodeURIComponent(trip.driver_email || trip.created_by)}&name=${encodeURIComponent(trip.driver_name || "السائق")}`}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/10 active:scale-[0.98] transition-all min-h-[44px]"
                            onClick={e => e.stopPropagation()}
                          >
                            <MessageCircle className="w-4 h-4" />
                            راسل السائق
                          </Link>

                          {/* Cancel booking — only shown before departure.
                              isTripExpired uses Asia/Jerusalem time so it's
                              correct regardless of where the passenger is. */}
                          {(status === "confirmed" || status === "pending") && !isTripExpired(trip) && (
                            <button
                              type="button"
                              onClick={() => {
                                const booking = passengerBookings.find(b => b.trip_id === trip.id);
                                if (booking) setConfirmCancel({
                                  open: true,
                                  bookingId: booking.id,
                                  tripDateTime: trip.date && trip.time
                                    ? `${trip.date}T${trip.time}:00`
                                    : (trip.date ? `${trip.date}T00:00:00` : null),
                                });
                              }}
                              disabled={cancelBookingMutation.isPending}
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-destructive/40 bg-destructive/5 text-destructive text-sm font-bold hover:bg-destructive/10 active:scale-[0.98] transition-all min-h-[44px] disabled:opacity-60"
                              aria-label="إلغاء الحجز"
                            >
                              <XCircle className="w-4 h-4" />
                              إلغاء الحجز
                            </button>
                          )}
                        </div>
                      )}

                      {/* Review button — appears as soon as the trip's
                          actual time window has elapsed (start + 30 min),
                          for any booking the user actually made on that
                          trip and hasn't already reviewed. Earlier we
                          required `status === "completed"`, but that
                          status only flips when the driver explicitly
                          taps "complete" in their dashboard — so most
                          real trips never became reviewable. Cancelled
                          bookings are explicitly excluded. */}
                      {bookedTripIds.has(trip.id)
                        && !reviewedTripIds.has(trip.id)
                        && isTripCompleted(trip)
                        && status !== "cancelled"
                        && status !== "cancelled_by_driver" && (
                        <div className="mt-3 mx-4">
                          <button
                            onClick={() => setWizardTrip(trip)}
                            className="w-full flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 hover:bg-yellow-100 transition-colors active:scale-[0.99]"
                          >
                            <div className="flex gap-0.5">
                              {[1,2,3,4,5].map(s => <Star key={s} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />)}
                            </div>
                            <span className="text-sm font-bold text-yellow-800">قيّم السائق {trip.driver_name || ""}</span>
                            <span className="text-xs text-yellow-600 mr-auto">اضغط هنا ←</span>
                          </button>
                        </div>
                      )}
                      {bookedTripIds.has(trip.id) && reviewedTripIds.has(trip.id) && isTripCompleted(trip) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 px-5 mt-2 pb-1">
                          <CheckCircle className="w-3 h-3 text-accent" />
                          شكراً — تم تقييم هذه الرحلة ✅
                        </p>
                      )}

                      {/* Book again — passenger-side mirror of the driver's
                          repost button. Appears on completed trips where the
                          user was a passenger (booked, not the driver). Drops
                          them into /search-trips pre-scoped to the same route,
                          so they can pick a fresh trip on the route they've
                          travelled before.

                          Why /search-trips and not /request-trip:
                          - The most common passenger flow is "find me an
                            existing trip on this route" not "post a new
                            request and wait". Search-first matches the
                            existing-driver supply.
                          - SearchTrips already reads from/to/date URL params
                            (lines 22-24), so navigating with them produces
                            an immediate scoped result.

                          Why no date prefill (unlike a more aggressive
                          'rebook next Monday' default):
                          - Forcing the date picker open keeps the user in
                            control of when they want to travel. Auto-picking
                            a date risks them booking the wrong day if they
                            click straight through.
                          - Empty date in SearchTrips means 'any date',
                            which is the most useful default for power
                            commuters scanning availability across the week.

                          Source: scale audit P1 #6 (2h estimate). */}
                      {bookedTripIds.has(trip.id)
                        && !driverTrips.find(dt => dt.id === trip.id)
                        && (status === "completed" || status === "cancelled") && (
                        <div className="mt-3 mx-4">
                          <Link
                            to={`/search?from=${encodeURIComponent(trip.from_city || "")}&to=${encodeURIComponent(trip.to_city || "")}`}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full flex items-center justify-center gap-2 bg-accent/5 hover:bg-accent/10 border border-accent/20 rounded-xl px-4 py-2.5 transition-colors active:scale-[0.99]"
                          >
                            <Repeat className="w-4 h-4 text-accent" aria-hidden="true" />
                            <span className="text-sm font-bold text-accent">
                              احجز رحلة مماثلة
                            </span>
                            <span className="text-[10px] text-muted-foreground mr-1">
                              ({trip.from_city} → {trip.to_city})
                            </span>
                          </Link>
                        </div>
                      )}

                      {/* Repost button — driver's own completed/cancelled trips
                          only. Quick path to re-create the same route without
                          re-entering every field. Navigates to /create-trip with
                          the trip's identifying fields as URL params, which the
                          CreateTrip page reads on mount to prefill the form.
                          Date is intentionally NOT included so the driver picks
                          a fresh future date (preventing accidental same-day
                          duplicates and matching the form's past-date guard).
                          Source: dashboard scale-audit P1 #3 (1h estimate). */}
                      {driverTrips.find(dt => dt.id === trip.id)
                        && (status === "completed" || status === "cancelled") && (
                        <div className="mt-3 mx-4">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Build URL params from the trip's repost-relevant
                              // fields. Keys match the CreateTrip form state
                              // shape (from_city, to_city, etc) for direct
                              // hydration on the other side. Amenities is a
                              // JSON array → CSV for URL safety.
                              const amenitiesCSV = Array.isArray(trip.amenities)
                                ? trip.amenities.filter(Boolean).join(",")
                                : "";
                              const paymentsCSV = Array.isArray(trip.payment_methods)
                                ? trip.payment_methods.filter(Boolean).join(",")
                                : "";
                              const params = new URLSearchParams({
                                from_city:       trip.from_city || "",
                                to_city:         trip.to_city   || "",
                                time:            trip.time      || "",
                                available_seats: String(trip.available_seats ?? 3),
                                price:           String(trip.price ?? 50),
                                ...(amenitiesCSV && { amenities: amenitiesCSV }),
                                ...(paymentsCSV  && { payment_methods: paymentsCSV }),
                                ...(trip.driver_note     && { driver_note: trip.driver_note }),
                                ...(trip.has_checkpoint  && { has_checkpoint: "1" }),
                                ...(trip.checkpoint_note && { checkpoint_note: trip.checkpoint_note }),
                              });
                              navigate(`/create-trip?${params.toString()}`);
                            }}
                            className="w-full flex items-center justify-center gap-2 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-xl px-4 py-2.5 transition-colors active:scale-[0.99]"
                          >
                            <Copy className="w-4 h-4 text-primary" aria-hidden="true" />
                            <span className="text-sm font-bold text-primary">
                              إعادة نشر هذه الرحلة
                            </span>
                            <span className="text-[10px] text-muted-foreground mr-1">
                              ({trip.from_city} → {trip.to_city})
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>
            );
          })}

          {/* ── Load More controls — one button per role section ────────
              Shown when the corresponding infinite-query has another
              page available. For drivers, this fetches the next 25
              trips matching the current filters (server-side via
              paginate). For passengers, it fetches the next 25 booking
              rows; the trip-fetch subquery re-runs automatically with
              the new trip_ids. Both buttons are disabled while loading
              to prevent double-firing. */}
          {(driverTripsInf.hasNextPage || passengerBookingsInf.hasNextPage) && (
            <div className="flex flex-col items-center gap-2 pt-2">
              {driverTripsInf.hasNextPage && (
                <Button
                  variant="outline"
                  onClick={() => driverTripsInf.fetchNextPage()}
                  disabled={driverTripsInf.isFetchingNextPage}
                  className="rounded-xl gap-2 min-w-[260px]"
                >
                  {driverTripsInf.isFetchingNextPage ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Car className="w-4 h-4" aria-hidden="true" />
                  )}
                  {driverTripsInf.isFetchingNextPage
                    ? "جاري التحميل..."
                    : `تحميل المزيد من رحلاتي كسائق (${driverTrips.length} من ${driverTotal})`}
                </Button>
              )}
              {passengerBookingsInf.hasNextPage && (
                <Button
                  variant="outline"
                  onClick={() => passengerBookingsInf.fetchNextPage()}
                  disabled={passengerBookingsInf.isFetchingNextPage}
                  className="rounded-xl gap-2 min-w-[260px]"
                >
                  {passengerBookingsInf.isFetchingNextPage ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle className="w-4 h-4" aria-hidden="true" />
                  )}
                  {passengerBookingsInf.isFetchingNextPage
                    ? "جاري التحميل..."
                    : `تحميل المزيد من حجوزاتي (${passengerBookings.length} من ${passengerTotal})`}
                </Button>
              )}
            </div>
          )}

          {/* All-loaded indicator — only shown when the user has loaded
              every page across both roles AND has results. Prevents the
              "is there more?" question on heavy histories. */}
          {!driverTripsInf.hasNextPage
            && !passengerBookingsInf.hasNextPage
            && trips.length > PAGE_SIZE && (
            <p className="text-center text-xs text-muted-foreground pt-2">
              ✓ تم تحميل جميع رحلاتك ({trips.length} من إجمالي {driverTotal + passengerTotal})
            </p>
          )}
        </div>
      )}
    {/* Passenger review wizard portal */}
    {wizardTrip && (
      <PassengerReviewWizard
        trip={wizardTrip}
        driverEmail={wizardTrip.driver_email || wizardTrip.created_by}
        driverName={wizardTrip.driver_name || "السائق"}
        passengerUser={user}
        onClose={() => setWizardTrip(null)}
      />
    )}

    {confirmCancel.open && (
      <ModalPortal>
      {/* Portal to document.body — without this, the fixed-position
          overlay would inherit its containing block from the closest
          ancestor with a CSS transform set. On mobile, AppLayout wraps
          every page in <PageTransition> (framer-motion's motion.div
          applies transforms during route transitions), which hijacks
          `position: fixed` and anchors it to the page instead of the
          viewport. Result: on scrolled pages the modal renders below
          the fold. ModalPortal escapes the transformed parent by
          mounting the overlay directly under <body>. */}
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmCancel({ open: false, bookingId: null, reason: "" })}>
        <div onClick={e => e.stopPropagation()} className="bg-card rounded-2xl p-6 max-w-sm w-full shadow-2xl" dir="rtl">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">إلغاء الحجز؟</h3>
          <p className="text-sm text-muted-foreground mb-3">هل أنت متأكد من إلغاء هذا الحجز؟ لا يمكن التراجع عن هذا الإجراء.</p>

          {/* Late-cancellation warning — shown when the trip is < 2h
              away. The DB will count this as a "strike" via migration
              018; we surface that to the user upfront so they can make
              an informed choice. 3 strikes in 30 days blocks new
              bookings until the rolling window passes. */}
          {(() => {
            if (!confirmCancel.tripDateTime) return null;
            const hoursUntil = (new Date(confirmCancel.tripDateTime).getTime() - Date.now()) / 3600000;
            if (hoursUntil <= 0 || hoursUntil >= 2) return null;
            return (
              <div className="mb-3 rounded-xl bg-destructive/5 border border-destructive/30 p-3">
                <p className="text-xs font-bold text-destructive mb-1 flex items-center gap-1.5">
                  ⚠️ تحذير: إلغاء متأخر
                </p>
                <p className="text-[11px] text-destructive/90 leading-relaxed">
                  هذا الإلغاء قبل أقل من ساعتين من موعد الرحلة وسيُسجَّل كنقطة سلبية في حسابك. تراكم 3 نقاط خلال 30 يوماً يؤدي إلى تعليق إمكانية الحجز مؤقتاً.
                </p>
              </div>
            );
          })()}

          {/* Optional reason — collected so admins can analyse cancel
              patterns later. Six common buckets cover most cases; an
              "other" option falls through to free text. */}
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">سبب الإلغاء (اختياري)</label>
          <select
            value={confirmCancel.reason}
            onChange={(e) => setConfirmCancel(c => ({ ...c, reason: e.target.value }))}
            className="w-full mb-4 px-3 py-2.5 rounded-xl bg-muted/50 border border-border text-sm outline-none"
          >
            <option value="">— اختر سبباً —</option>
            <option value="changed_plans">تغيرت خططي</option>
            <option value="found_alternative">وجدت وسيلة نقل أخرى</option>
            <option value="trip_time_no_longer_works">وقت الرحلة لم يعد مناسباً</option>
            <option value="driver_unresponsive">السائق لم يرد</option>
            <option value="price_too_high">السعر مرتفع</option>
            <option value="emergency">حالة طارئة</option>
            <option value="other">سبب آخر</option>
          </select>

          <div className="flex gap-3">
            <button onClick={() => setConfirmCancel({ open: false, bookingId: null, reason: "" })} className="flex-1 px-4 py-2.5 bg-muted text-foreground rounded-xl font-medium text-sm">
              تراجع
            </button>
            <button
              onClick={() => {
                cancelBookingMutation.mutate({ bookingId: confirmCancel.bookingId, reason: confirmCancel.reason || null });
                setConfirmCancel({ open: false, bookingId: null, reason: "" });
              }}
              className="flex-1 px-4 py-2.5 bg-destructive text-destructive-foreground rounded-xl font-bold text-sm"
              disabled={cancelBookingMutation.isPending}
            >
              نعم، ألغِ الحجز
            </button>
          </div>
        </div>
      </div>
      </ModalPortal>
    )}

    {/* Delete confirmation modal */}
    {deleteConfirm.open && (
      <ModalPortal>
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => setDeleteConfirm({ open: false, tripId: null, isBulk: false })}>
        <div onClick={e => e.stopPropagation()} className="bg-card rounded-2xl p-6 max-w-sm w-full shadow-2xl" dir="rtl">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">
            {deleteConfirm.isBulk ? 'حذف الرحلات المحددة؟' : 'حذف هذه الرحلة؟'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {deleteConfirm.isBulk 
              ? `سيتم حذف ${selectedTrips.size} رحلة من سجلك. هذا الإجراء لا يمكن التراجع عنه.`
              : 'سيتم حذف هذه الرحلة من سجلك. هذا الإجراء لا يمكن التراجع عنه.'
            }
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteConfirm({ open: false, tripId: null, isBulk: false })}
              className="flex-1 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-xl font-bold text-sm"
            >
              إلغاء
            </button>
            <button
              onClick={() => {
                const idsToDelete = deleteConfirm.isBulk 
                  ? Array.from(selectedTrips)
                  : [deleteConfirm.tripId];
                deleteTripMutation.mutate(idsToDelete);
              }}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700"
              disabled={deleteTripMutation.isPending}
            >
              {deleteTripMutation.isPending ? 'جاري الحذف...' : 'نعم، احذف'}
            </button>
          </div>
        </div>
      </div>
      </ModalPortal>
    )}
    </div>
  );
}