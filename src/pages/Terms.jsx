import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from "@/lib/legalContent";

function formatArabicMonthYear(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}

export default function Terms() {
  useSEO({ title: "شروط الاستخدام", description: "شروط استخدام منصة مشوارو" });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12" dir="rtl">
      <h1 className="text-3xl font-black mb-2">شروط الاستخدام</h1>
      <p className="text-muted-foreground text-sm mb-8">آخر تحديث: {formatArabicMonthYear(TERMS_LAST_UPDATED)}</p>

      {TERMS_SECTIONS.map(s => (
        <div key={s.title} className="mb-6">
          <h2 className="text-lg font-bold text-foreground mb-2">{s.title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
