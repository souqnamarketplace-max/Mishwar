import React from "react";
import { Link } from "react-router-dom";
import { Users, Target, Heart, Shield, ArrowLeft } from "lucide-react";

const values = [
  { icon: Heart, title: "المجتمع أولاً", desc: "نؤمن بقوة المجتمع وأهمية التعاون بين أبناء فلسطين" },
  { icon: Shield, title: "الأمان والثقة", desc: "نضمن تجربة آمنة وموثوقة لكل سائق وراكب" },
  { icon: Target, title: "الاستدامة", desc: "نساهم في تقليل الازدحام والبصمة الكربونية" },
  { icon: Users, title: "الشمول", desc: "خدماتنا متاحة لجميع المدن والمناطق الفلسطينية" },
];

const team = [
  { name: "أحمد سالم", role: "المؤسس والرئيس التنفيذي", emoji: "👨‍💼" },
  { name: "سارة خالد", role: "مديرة المنتج", emoji: "👩‍💻" },
  { name: "محمد عمر", role: "مدير التقنية", emoji: "👨‍💻" },
  { name: "لينا حسن", role: "مديرة التسويق", emoji: "👩‍🎨" },
];

export default function AboutUs() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        الرئيسية
      </Link>

      {/* Hero */}
      <div className="text-center mb-12">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-primary">س</span>
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-3">من نحن</h1>
        <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
          سيرتنا هي منصة فلسطينية لمشاركة الرحلات، تهدف إلى ربط السائقين بالمسافرين بطريقة آمنة وموثوقة واقتصادية.
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

      {/* Team */}
      <h2 className="text-xl font-bold text-foreground mb-4">فريقنا</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {team.map((member) => (
          <div key={member.name} className="bg-card rounded-2xl border border-border p-4 text-center">
            <div className="text-4xl mb-2">{member.emoji}</div>
            <h3 className="font-bold text-sm text-foreground">{member.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">{member.role}</p>
          </div>
        ))}
      </div>
    </div>
  );
}