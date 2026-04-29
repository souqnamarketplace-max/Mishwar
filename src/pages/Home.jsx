import { useSEO } from "@/hooks/useSEO";
import React from "react";
import HeroSection from "../components/home/HeroSection";
import StatsBar from "../components/home/StatsBar";
import HowItWorks from "../components/home/HowItWorks";
import FeaturedTrips from "../components/home/FeaturedTrips";
import TrustBadges from "../components/home/TrustBadges";
import CTASection from "../components/home/CTASection";
import AnnouncementBanner from "../components/home/AnnouncementBanner";

export default function Home() {
  useSEO({ title: "الرئيسية", description: "منصة فلسطينية لمشاركة رحلات السيارة بين المدن. وفر المال وسافر بأمان مع مِشوار." });

  return (
    <div>
      <AnnouncementBanner />
      <HeroSection />
      <StatsBar />
      <FeaturedTrips />
      <HowItWorks />
      <TrustBadges />
      <CTASection />
    </div>
  );
}