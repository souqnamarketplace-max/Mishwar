import { useEffect } from "react";

/**
 * Set document title and meta description per page.
 * Call inside any page component.
 *
 * @example
 * useSEO({ title: "البحث عن رحلة", description: "ابحث عن رحلات بين المدن الفلسطينية" });
 */
export function useSEO({ title, description, canonical, ogImage }) {
  useEffect(() => {
    const fullTitle = title ? `${title} | مِشوار` : "مِشوار — شارك الطريق، وفر أكثر";
    document.title = fullTitle;

    // Update meta description
    if (description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement("meta");
        metaDesc.setAttribute("name", "description");
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute("content", description);
    }

    // Update OG title
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", fullTitle);

    // Update OG description
    if (description) {
      let ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute("content", description);
    }

    // Update canonical
    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", canonical);
    }

    // Update OG image
    if (ogImage) {
      let ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) ogImg.setAttribute("content", ogImage);
    }
  }, [title, description, canonical, ogImage]);
}
