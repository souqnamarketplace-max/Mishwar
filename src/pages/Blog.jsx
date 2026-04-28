import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, User } from "lucide-react";

const posts = [
  {
    id: 1,
    title: "كيف تجعل رحلتك اليومية أكثر اقتصادية؟",
    excerpt: "نصائح عملية لتوفير المال عبر مشاركة الرحلات مع زملاء العمل والجيران.",
    date: "15 أبريل 2024",
    author: "فريق سيرتنا",
    emoji: "💡",
    category: "نصائح",
  },
  {
    id: 2,
    title: "سيرتنا تطلق خدماتها في مدينة نابلس",
    excerpt: "توسعنا الجديد يشمل أكثر من 50 سائقاً موثقاً في المدينة، مع عروض ترحيبية للمستخدمين الجدد.",
    date: "2 مارس 2024",
    author: "أحمد سالم",
    emoji: "🚀",
    category: "أخبار",
  },
  {
    id: 3,
    title: "أمان الرحلة: كيف نحمي مستخدمينا؟",
    excerpt: "نظام التحقق من الهوية والتقييمات يجعل سيرتنا الأكثر أماناً في المنطقة.",
    date: "20 فبراير 2024",
    author: "سارة خالد",
    emoji: "🛡️",
    category: "أمان",
  },
  {
    id: 4,
    title: "5 أسباب تجعلك تختار مشاركة الرحلات",
    excerpt: "من توفير الوقود إلى تقليل الازدحام، اكتشف لماذا يختار الآلاف سيرتنا يومياً.",
    date: "10 يناير 2024",
    author: "فريق سيرتنا",
    emoji: "🌟",
    category: "نصائح",
  },
];

export default function Blog() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        الرئيسية
      </Link>

      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-foreground mb-2">مدونة سيرتنا</h1>
        <p className="text-muted-foreground">أخبار، نصائح، وقصص من مجتمع سيرتنا</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {posts.map((post) => (
          <div key={post.id} className="bg-card rounded-2xl border border-border overflow-hidden hover:shadow-md transition-all cursor-pointer">
            <div className="h-28 bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center text-5xl">
              {post.emoji}
            </div>
            <div className="p-5">
              <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                {post.category}
              </span>
              <h2 className="font-bold text-foreground mt-2 mb-2 leading-snug">{post.title}</h2>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{post.excerpt}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{post.date}</span>
                <span className="flex items-center gap-1"><User className="w-3 h-3" />{post.author}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}