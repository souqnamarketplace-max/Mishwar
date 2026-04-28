import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Search, SlidersHorizontal, ArrowLeft } from "lucide-react";
import SelectDrawer from "@/components/ui/select-drawer";
import TripCard from "../components/shared/TripCard";

const CITIES = [
  // محافظة رام الله والبيرة
  "رام الله", "البيرة", "الرام", "العيزرية", "أبو ديس", "بيتونيا", "بيتين", "دير الديبة",
  "دير قديس", "الجيب", "الطيبة", "قالقيلية", "قطنة", "كفر نعمة", "مخماس", "نعلين",
  // محافظة جنين
  "جنين", "جنين مخيم", "اليامون", "برقين", "سيلة الظهر", "أم قيس", "قبلان", "قفين",
  "مسلية", "نابلس", "يعبد", "الزبابدة",
  // محافظة نابلس
  "نابلس", "بيتا", "بيت دجن", "جمّاعين", "حوّارة", "العوجا", "سنيريا", "دير الشرقية",
  "دير الغربية", "رويبة", "سالم", "عين بويطة", "عيناتا", "قريوط", "كفر قدوم", "لوبان",
  // محافظة طولكرم
  "طولكرم", "علّار", "الطيرة", "كفر اللبد", "رنتيس", "دنابة", "سهيلة", "شويكة",
  "عنبتا", "قيقس", "نور شمس",
  // محافظة قلقيلية
  "قلقيلية", "عصيرة", "جينصافة", "كفر اللبد", "هبلة", "عزون", "الرنتاوي",
  // محافظة سلفيت
  "سلفيت", "برقة", "بروقين", "الجديرة", "دير بلوط", "جيوس", "كفر الديك", "خربة ام الراعي",
  // محافظة الخليل
  "الخليل", "بيت لحم", "دورا", "الظاهرية", "سعير", "تفوح", "يطا", "إذنا",
  "كرمة وسار", "بني نعيم", "هارون", "بت جبرين", "البقعة", "ثغرة الغور",
  // محافظة بيت لحم
  "بيت لحم", "بيت ساحور", "بيت جالا", "جنين (بيت لحم)", "الجرعة", "بتّير", "الخضر",
  "بيت فجار", "علار", "كفر المالك", "واد علار", "نحالين",
  // محافظة أريحا والأغوار
  "أريحا", "نويعمة", "الأغوار الشمالية", "الجفتليك", "الأغوار الوسطى", "الأغوار الجنوبية",
  "إن الدويك", "الدويك", "الخان الأحمر", "جراش",
  // محافظة القدس
  "القدس القديمة", "ضواحي القدس", "أم الشرايط", "جبل المكبر", "الرام", "شعفاط",
  "سلوان", "البيضاء", "الطور",
  // مدن وقرى أخرى
  "جنود", "بيت أمين", "بديا", "بيت رزين", "عيرتا", "فاطورة", "قسيم", "مجدل بني فاضل",
  "شقبا", "سالم", "نحالين", "كفر مالك", "الجيب"
];

export default function SearchTrips() {
  const [searchParams] = useSearchParams();
  const [from, setFrom] = useState(searchParams.get("from") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [date, setDate] = useState(searchParams.get("date") || "");
  const [activeFilters, setActiveFilters] = useState({
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    date: searchParams.get("date") || "",
  });

  const qc = useQueryClient();
  const { data: trips = [], isLoading } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 50),
  });

  // Real-time subscription for trip updates
  useEffect(() => {
    const unsubscribe = base44.entities.Trip.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    });
    return () => unsubscribe();
  }, [qc]);

  const handleSearch = () => setActiveFilters({ from, to, date });

  const filtered = trips.filter((t) => {
    if (activeFilters.from && t.from_city !== activeFilters.from) return false;
    if (activeFilters.to && t.to_city !== activeFilters.to) return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Search Bar */}
      <div className="bg-card rounded-2xl border border-border p-4 mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="hidden sm:block relative">
            <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full h-11 pr-10 pl-4 rounded-xl bg-muted/50 border-0 text-sm"
            >
              <option value="">من أين؟</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:hidden">
            <SelectDrawer
              value={from}
              onChange={setFrom}
              options={CITIES.map(c => ({ value: c, label: c }))}
              placeholder="من أين؟"
            />
          </div>
          <div className="hidden sm:block relative">
            <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full h-11 pr-10 pl-4 rounded-xl bg-muted/50 border-0 text-sm"
            >
              <option value="">إلى أين؟</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:hidden">
            <SelectDrawer
              value={to}
              onChange={setTo}
              options={CITIES.map(c => ({ value: c, label: c }))}
              placeholder="إلى أين؟"
            />
          </div>
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 pr-10 rounded-xl bg-muted/50 border-0"
            />
          </div>
          <Button className="h-11 bg-primary text-primary-foreground rounded-xl gap-2" onClick={handleSearch}>
            <Search className="w-4 h-4" />
            بحث
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-foreground">
          {filtered.length} رحلة متاحة
        </h2>
        <Button variant="outline" size="sm" className="rounded-lg gap-2">
          <SlidersHorizontal className="w-4 h-4" />
          تصفية
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-6 animate-pulse">
              <div className="h-5 bg-muted rounded w-48 mb-3" />
              <div className="h-4 bg-muted rounded w-32 mb-3" />
              <div className="h-10 bg-muted rounded w-full" />
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات متاحة</h3>
          <p className="text-muted-foreground text-sm">جرّب تغيير معايير البحث أو أنشئ رحلة جديدة</p>
        </div>
      )}
    </div>
  );
}