import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MapPin, Search, Clock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * SeoLandingLayout — shared structure for /routes/* and /cities/* pages.
 *
 * Why a layout component instead of duplicating the JSX 5x:
 *   - Consistent semantic structure (one H1, ordered H2s, breadcrumb,
 *     CTAs to /search and /request-trip)
 *   - Easier to A/B test layout changes across all landing pages
 *   - Each page only writes its CONTENT (title, intro, FAQs, internal
 *     links) — the chrome is shared
 *
 * What pages pass in:
 *   - title:        Arabic H1 (e.g. "رحلات رام الله — نابلس")
 *   - subtitle:     Arabic tagline (1 sentence)
 *   - intro:        2-3 paragraph Arabic body
 *   - sections:     [{ heading: H2 text, body: paragraph or jsx }]
 *   - related:      [{ label, path }] internal links to related pages
 *   - searchLink:   pre-filled /search URL for "ابحث الآن" CTA
 *   - breadcrumbs:  for visual breadcrumb bar (also used in JSON-LD
 *                   via <SEO breadcrumbs={...} />)
 */
export default function SeoLandingLayout({
  title,
  subtitle,
  intro,
  sections = [],
  related = [],
  searchLink = "/search",
  breadcrumbs = [],
  children,
}) {
  return (
    <article className="max-w-4xl mx-auto px-4 sm:px-6 py-8" dir="rtl">
      {/* Visual breadcrumb (BreadcrumbList JSON-LD lives in <SEO />) */}
      {breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground mb-4 flex items-center gap-1.5 flex-wrap">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={b.path}>
              {i > 0 && <span className="opacity-50">/</span>}
              {i === breadcrumbs.length - 1 ? (
                <span aria-current="page" className="text-foreground">{b.name}</span>
              ) : (
                <Link to={b.path} className="hover:text-foreground hover:underline">{b.name}</Link>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* Hero — single H1 per page (semantic SEO requirement) */}
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-black text-foreground mb-3 leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-lg text-muted-foreground leading-relaxed">
            {subtitle}
          </p>
        )}
      </header>

      {/* CTA bar — primary action for any landing page is "search the route".
          Secondary action is "post a request" for users who can't find
          a matching trip. */}
      <div className="bg-primary/5 border border-primary/15 rounded-2xl p-5 mb-10 flex flex-col sm:flex-row gap-3">
        <Link to={searchLink} className="flex-1">
          <Button className="w-full h-12 rounded-xl gap-2 text-base">
            <Search className="w-5 h-5" />
            ابحث عن رحلة الآن
          </Button>
        </Link>
        <Link to="/request-trip" className="flex-1">
          <Button variant="outline" className="w-full h-12 rounded-xl gap-2 text-base border-primary/30 text-primary">
            <MapPin className="w-5 h-5" />
            اطلب رحلة جديدة
          </Button>
        </Link>
      </div>

      {/* Intro body — 2-3 paragraphs of Arabic prose. This is the
          highest-weight indexable content on the page. */}
      {intro && (
        <section className="prose prose-lg max-w-none mb-10 text-foreground/90 leading-loose">
          {typeof intro === "string"
            ? intro.split("\n\n").map((p, i) => <p key={i}>{p}</p>)
            : intro
          }
        </section>
      )}

      {/* Trust strip — generic but adds visual weight + signals to
          users that the site is legit. The icons aren't decorative
          (alt-equivalent labels via aria-hidden + adjacent text). */}
      <div className="grid grid-cols-3 gap-3 mb-10">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <Shield className="w-6 h-6 mx-auto mb-2 text-primary" aria-hidden />
          <p className="text-xs sm:text-sm font-medium">سائقون موثَّقون</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <Clock className="w-6 h-6 mx-auto mb-2 text-primary" aria-hidden />
          <p className="text-xs sm:text-sm font-medium">حجز فوري</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <MapPin className="w-6 h-6 mx-auto mb-2 text-primary" aria-hidden />
          <p className="text-xs sm:text-sm font-medium">يغطي فلسطين</p>
        </div>
      </div>

      {/* Body sections — each section is a H2 + paragraph(s). Important
          for both SEO (Google reads heading hierarchy) and accessibility
          (screen readers use headings for navigation). */}
      {sections.map((s, i) => (
        <section key={i} className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-3">{s.heading}</h2>
          <div className="text-foreground/85 leading-loose space-y-3">
            {typeof s.body === "string"
              ? s.body.split("\n\n").map((p, j) => <p key={j}>{p}</p>)
              : s.body
            }
          </div>
        </section>
      ))}

      {/* Page-specific extra children (e.g. FAQ accordion) */}
      {children}

      {/* Internal links to related pages — SEO best practice + helps
          users discover similar content. Real internal-linking power
          comes from these being CONTEXTUAL (city A's page links to
          neighboring cities, not random ones). */}
      {related.length > 0 && (
        <section className="bg-muted/30 border border-border rounded-2xl p-6 mt-10">
          <h2 className="text-xl font-bold text-foreground mb-4">صفحات ذات صلة</h2>
          <div className="flex flex-wrap gap-2">
            {related.map((r) => (
              <Link
                key={r.path}
                to={r.path}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded-xl text-sm hover:bg-primary/5 hover:border-primary/30 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 rotate-180 opacity-60" />
                {r.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
