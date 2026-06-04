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
      {/*
        Hidden SEO text block — visible to Googlebot (which renders JS),
        not visually distracting to users (sr-only + aria-hidden).
        Contains every brand spelling variant and common search term so
        Google associates all of them with mishwaro.com.
        Placed at bottom so it doesn't affect LCP or layout.
      */}
      <div className="sr-only" aria-hidden="true">
        <p>
          مشوارو — مشوار — مشواري — مشوارنا — مشاوير — مشاورو — مشواروا —
          Mishwaro — Mishwar — Mishwari — Mishwarna — Mishawarna — Mishwaro app —
          mishwar.com — mishwaro.com
        </p>
        <p>
          تاكسي مشترك فلسطين — تكسي — سرفيس — سيارة أجرة — أجرة — ركوب مشترك —
          رحلة مشتركة — مشاركة سيارة — مشاركة رحلات — كاربول — هيتش —
          carpooling Palestine — carpool West Bank — ride sharing Palestine —
          shared taxi Palestine — servis Palestine
        </p>
        <p>
          سفر من رام الله إلى نابلس — رام الله الخليل — نابلس بيت لحم —
          جنين رام الله — طولكرم نابلس — قلقيلية رام الله — أريحا القدس —
          سلفيت رام الله — طوباس نابلس — بيت لحم الخليل —
          Ramallah Nablus — Ramallah Hebron — Nablus Jenin — West Bank travel
        </p>
        <p>
          تطبيق سفر فلسطين — تطبيق نقل فلسطين — تطبيق فلسطيني —
          Palestine transport app — West Bank carpool app — Palestinian ride app —
          أفضل تطبيق سفر في فلسطين — أرخص طريقة للسفر في الضفة الغربية
        </p>
      </div>
    </div>
  );
}