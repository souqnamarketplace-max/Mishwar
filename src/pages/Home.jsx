import { useSEO } from "@/hooks/useSEO";
import React from "react";
import HeroSection from "../components/home/HeroSection";
import StatsBar from "../components/home/StatsBar";
import RequestsTeaser from "../components/home/RequestsTeaser";
import HowItWorks from "../components/home/HowItWorks";
import FeaturedTrips from "../components/home/FeaturedTrips";
import TrustBadges from "../components/home/TrustBadges";
import CTASection from "../components/home/CTASection";
import AnnouncementBanner from "../components/home/AnnouncementBanner";

export default function Home() {
  useSEO({
    title: "مشوارو — مشاركة الرحلات بين المدن الفلسطينية",
    description: "أول منصة فلسطينية لمشاركة رحلات السيارة بين المدن. سافر من رام الله، نابلس، الخليل، بيت لحم، جنين، طولكرم وأكثر من 320 مدينة — بنص السعر مع سائقين موثّقين. سجّل مجاناً.",
  });

  return (
    <div>
      <AnnouncementBanner />
      <HeroSection />
      <StatsBar />
      <RequestsTeaser />
      <FeaturedTrips />
      <HowItWorks />
      <TrustBadges />
      <CTASection />
    </div>
  );
}