import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import EmptyState from "@/components/shared/EmptyState";

// Posts are fetched from public.blog_posts. The previous hardcoded
// array contained four fictional posts dated 2024 with specific factual
// claims (e.g. "50+ verified drivers in Nablus") that weren't true.
// When the table is empty we show a friendly "coming soon" empty state
// instead of fake content.

function formatArabicDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric", month: "long", year: "numeric"
    }).format(d);
  } catch { return ""; }
}

export default function Blog() {
  useSEO({ title: "المدونة", description: "مقالات ونصائح من فريق مِشوار" });

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["blog-posts-published"],
    queryFn: () => base44.entities.BlogPost.filter(
      { is_published: true },
      "-published_at",
      50
    ),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        الرئيسية
      </Link>

      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-foreground mb-2">مدونة مِشوار</h1>
        <p className="text-muted-foreground">أخبار، نصائح، وقصص من مجتمع مِشوار</p>
      </div>

      {!isLoading && posts.length === 0 && (
        <div className="py-12">
          <EmptyState
            emoji="📰"
            title="قريباً..."
            description="نحضّر لكم مقالات مفيدة عن السفر ومشاركة الرحلات في فلسطين."
          />
        </div>
      )}

      {posts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {posts.map((post) => (
            <div key={post.id} className="bg-card rounded-2xl border border-border overflow-hidden hover:shadow-md transition-all">
              {post.cover_url
                ? <div className="h-28 overflow-hidden">
                    <img loading="lazy" decoding="async" src={post.cover_url} alt="" className="w-full h-full object-cover" />
                  </div>
                : <div className="h-28 bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center text-5xl">
                    {post.emoji || "📝"}
                  </div>}
              <div className="p-5">
                {post.category && (
                  <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                    {post.category}
                  </span>
                )}
                <h2 className="font-bold text-foreground mt-2 mb-2 leading-snug">{post.title}</h2>
                {post.excerpt && (
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{post.excerpt}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {post.published_at && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatArabicDate(post.published_at)}
                    </span>
                  )}
                  {post.author_name && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {post.author_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
