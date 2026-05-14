import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/lib/legalContent";

// ⚠️ LAWYER REVIEW REQUIRED before launch (audit C-10).
// The text in src/lib/legalContent.js was edited 2026-05-06 to make
// the technical claims accurate (GPS during active trips, localStorage
// instead of cookies, sub-processors disclosed). It is NOT a substitute
// for review by a lawyer familiar with Palestinian law + GDPR + CCPA.
// Bump PRIVACY_LAST_UPDATED when the lawyer's revisions land.

function formatArabicMonthYear(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}

export default function PrivacyPolicy() {
  useSEO({ title: "سياسة الخصوصية", description: "سياسة خصوصية وحماية البيانات في مشوارو" });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12" dir="rtl">
      <h1 className="text-3xl font-black mb-2">سياسة الخصوصية</h1>
      <p className="text-muted-foreground text-sm mb-8">آخر تحديث: {formatArabicMonthYear(PRIVACY_LAST_UPDATED)}</p>

      {PRIVACY_SECTIONS.map(s => (
        <div key={s.title} className="mb-6">
          <h2 className="text-lg font-bold text-foreground mb-2">{s.title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
