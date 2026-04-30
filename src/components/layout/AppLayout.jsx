import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { AnimatePresence } from "framer-motion";
import Navbar from "./Navbar";
import Footer from "./Footer";
import MobileLayout from "./MobileLayout";
import NetworkStatus from "@/components/NetworkStatus";
import PageTransition from "../PageTransition";
import PullToRefresh from "../shared/PullToRefresh";

export default function AppLayout() {
  const location = useLocation();
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== "undefined" && window.innerWidth < 1024
  );

  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  if (isMobile) {
    return (
      <MobileLayout user={user}>
        <PullToRefresh>
          <AnimatePresence mode="wait">
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </PullToRefresh>
      </MobileLayout>
    );
  }

  return (
    <>
    <NetworkStatus />
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <PullToRefresh>
          <AnimatePresence mode="wait">
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </PullToRefresh>
      </main>
      <Footer />
    </div>
    </>
  );
}