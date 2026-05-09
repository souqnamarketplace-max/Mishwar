import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { Link } from "react-router-dom";
import { Users, Target, Heart, Shield, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const values = [
  { icon: Heart, title: "المجتمع أولاً", desc: "نؤمن بقوة المجتمع وأهمية التعاون بين أبناء فلسطين" },
  { icon: Shield, title: "الأمان والثقة", desc: "نضمن تجربة آمنة وموثوقة لكل سائق وراكب" },
  { icon: Target, title: "الاستدامة", desc: "نساهم في تقليل الازدحام والبصمة الكربونية" },
  { icon: Users, title: "الشمول", desc: "خدماتنا متاحة لجميع المدن والمناطق الفلسطينية" },
];

// Team is fetched from public.team_members. The previous hardcoded
// array listed four fictional team members with executive titles —
// dishonest to users and a likely App Store rejection (review process
// asks "are these real people?"). When the table is empty the team
// section hides entirely.

export default function AboutUs() {
  useSEO({ title: "من نحن", description: "تعرف على مشوارو — منصة فلسطينية لمشاركة الرحلات" });

  const { data: team = [] } = useQuery({
    queryKey: ["team-members-published"],
    queryFn: () => base44.entities.TeamMember.filter({ is_published: true }, "sort_order", 50),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        الرئيسية
      </Link>

      {/* Hero */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center mx-auto mb-4">
          <img src="/logo.png" alt="مشوارو" className="w-20 h-20 rounded-2xl object-cover shadow-lg" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-3">من نحن</h1>
        <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
          مشوارو هي منصة فلسطينية لمشاركة الرحلات، تهدف إلى ربط السائقين بالمسافرين بطريقة آمنة وموثوقة واقتصادية.
          انطلقنا عام 2023 من رام الله بحلم واحد: تسهيل التنقل لكل فلسطيني.
        </p>
      </div>

      {/* Mission */}
      <div className="bg-card rounded-2xl border border-border p-6 mb-8">
        <h2 className="text-xl font-bold text-foreground mb-3">مهمتنا</h2>
        <p className="text-muted-foreground leading-relaxed">
          نسعى إلى بناء مجتمع تنقل ذكي ومستدام في فلسطين، من خلال توفير منصة تقنية تمكّن الناس من مشاركة رحلاتهم
          اليومية وتوفير التكاليف، مع ضمان أعلى معايير الأمان والثقة المتبادلة.
        </p>
      </div>

      {/* Values */}
      <h2 className="text-xl font-bold text-foreground mb-4">قيمنا</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {values.map((v) => (
          <div key={v.title} className="bg-card rounded-2xl border border-border p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <v.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground mb-1">{v.title}</h3>
              <p className="text-sm text-muted-foreground">{v.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Team — hidden until admin populates the table. */}
      {team.length > 0 && (
        <>
          <h2 className="text-xl font-bold text-foreground mb-4">فريقنا</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {team.map((member) => (
              <div key={member.id} className="bg-card rounded-2xl border border-border p-4 text-center">
                {member.avatar_url
                  ? <img loading="lazy" decoding="async" src={member.avatar_url} alt="" className="w-16 h-16 rounded-full mx-auto mb-2 object-cover" />
                  : <div className="text-4xl mb-2">{member.emoji || "👤"}</div>}
                <h3 className="font-bold text-sm text-foreground">{member.full_name}</h3>
                {member.role_title && <p className="text-xs text-muted-foreground mt-1">{member.role_title}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}