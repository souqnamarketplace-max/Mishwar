import React from "react";
import HeroSection from "../components/home/HeroSection";
import StatsBar from "../components/home/StatsBar";
import HowItWorks from "../components/home/HowItWorks";
import FeaturedTrips from "../components/home/FeaturedTrips";
import TrustBadges from "../components/home/TrustBadges";
import CTASection from "../components/home/CTASection";

export default function Home() {
  return (
    <div>
      <HeroSection />
      <StatsBar />
      <FeaturedTrips />
      <HowItWorks />
      <TrustBadges />
      <CTASection />
    </div>
  );
}