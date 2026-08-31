import type { MetadataRoute } from "next";

/**
 * There is nothing here a search engine should index. Tree URLs are guessable
 * slugs, and confirming "a family by this name has a tree" is exactly the kind
 * of leak the rest of the project works to avoid.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
