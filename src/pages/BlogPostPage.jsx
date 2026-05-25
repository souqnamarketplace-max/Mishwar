import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSEO } from "@/hooks/useSEO";

function formatArabicDate(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric", month: "long", year: "numeric",
    }).format(new Date(iso));
  } catch { return ""; }
}

// Minimal Markdown → HTML renderer (bold, italic, links, headings, lists, hr).
// We don't ship a full MD library to keep bundle size small.
function renderMarkdown(md) {
  if (!md) return "";
  return md
    // headings
    .replace(/^### (.+)$/gm, "<h3 class=\"text-lg font-bold text-foreground mt-6 mb-2\">$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2 class=\"text-xl font-bold text-foreground mt-8 mb-3\">$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1 class=\"text-2xl font-bold text-foreground mt-8 mb-4\">$1</h1>")
    // bold / italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    // links  [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      "<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"text-primary underline hover:opacity-75\">$1</a>")
    // unordered list items
    .replace(/^- (.+)$/gm, "<li class=\"mr-4 list-disc\">$1</li>")
    .replace(/(<li[\s\S]+?<\/li>)/g, "<ul class=\"space-y-1 my-3\">$1</ul>")
    // horizontal rule
    .replace(/^---$/gm, "<hr class=\"my-6 border-border\"/>")
    // paragraphs — double newline
    .split(/\n\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block =>
      block.startsWith("<h") || block.startsWith("<ul") || block.startsWith("<hr")
        ? block
        : `<p class="text-foreground/80 leading-relaxed mb-4">${block.replace(/\n/g, "<br/>")}</p>`
    )
    .join("\n");
}

export default function BlogPostPage() {
  const { slug } = useParams();

  const { data: post, isLoading, isError } = useQuery({
    queryKey: ["blog-post", slug],
    queryFn: async () => {
      // Try slug first, fall back to id (for posts saved before slug fix)
      let { data, error } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // fallback: try matching by id
        ({ data, error } = await supabase
          .from("blog_posts")
          .select("*")
          .eq("id", slug)
          .eq("is_published", true)
          .maybeSingle());
        if (error) throw error;
      }
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  useSEO({
    title: post?.title || "مقال",
    description: post?.excerpt || "",
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center text-muted-foreground">
        جاري التحميل...
      </div>
    );
  }

  if (isError || !post) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground text-lg mb-4">لم يتم العثور على المقال</p>
        <Link to="/blog" className="text-primary underline text-sm">← العودة إلى المدونة</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10" dir="rtl">
      {/* Back */}
      <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        المدونة
      </Link>

      {/* Cover or emoji */}
      {post.cover_url ? (
        <img src={post.cover_url} alt="" className="w-full h-52 object-cover rounded-2xl mb-6" />
      ) : (
        <div className="w-full h-40 bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl flex items-center justify-center text-6xl mb-6">
          {post.emoji || "📝"}
        </div>
      )}

      {/* Category */}
      {post.category && (
        <span className="text-xs bg-primary/10 text-primary rounded-full px-3 py-1 font-medium">
          {post.category}
        </span>
      )}

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl font-black text-foreground mt-4 mb-3 leading-snug">
        {post.title}
      </h1>

      {/* Meta */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-8 pb-6 border-b border-border">
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

      {/* Body */}
      {post.body ? (
        <article
          className="prose-mishwaro text-base leading-loose"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
        />
      ) : post.excerpt ? (
        <p className="text-foreground/80 leading-relaxed">{post.excerpt}</p>
      ) : null}

      {/* Footer nav */}
      <div className="mt-12 pt-6 border-t border-border">
        <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-primary hover:opacity-75">
          <ArrowLeft className="w-4 h-4 rotate-180" />
          العودة إلى جميع المقالات
        </Link>
      </div>
    </div>
  );
}
