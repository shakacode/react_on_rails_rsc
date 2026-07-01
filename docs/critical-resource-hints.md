# Critical Resource Hints for RSC Pages

RSC pages can emit browser resource hints while the server component tree renders.
Import the helpers from the `react-on-rails-rsc/server` export that your RSC bundle
already uses, and pass production URLs that the host app has already resolved from
its Rails, Shakapacker, webpack, or rspack manifests.

```tsx
import {
  preconnect,
  prefetchDNS,
  preinitStyle,
  preloadFont,
  preloadImage,
  preloadScript,
  preloadStyle,
} from 'react-on-rails-rsc/server';

export default function WelcomePage() {
  prefetchDNS('https://cdn.example.com');
  preconnect('https://assets.example.com', { crossOrigin: 'anonymous' });

  preinitStyle('/packs/generated/WelcomePage.css');
  preloadStyle('/packs/generated/WelcomePage-abcd1234.css', { fetchPriority: 'high' });
  preloadScript('/packs/generated/WelcomePage-abcd1234.js');
  preloadFont('/assets/Poppins-600-abcd1234.woff2', { type: 'font/woff2' });
  preloadImage('/assets/listing-price-comparison-abcd1234.webp', {
    fetchPriority: 'high',
    imageSrcSet:
      '/assets/listing-price-comparison-abcd1234.webp 1x, /assets/listing-price-comparison@2x-abcd1234.webp 2x',
    imageSizes: '100vw',
  });

  return <main>{/* page content */}</main>;
}
```

The helpers are thin wrappers around React DOM's RSC-aware resource hint APIs:

- `prefetchDNS(href)`
- `preconnect(href, options)`
- `preloadAsset(href, { as, ...options })`
- `preloadStyle(href, options)`
- `preinitStyle(href, options)`
- `preloadScript(href, options)`
- `preinitScript(href, options)`
- `preloadFont(href, options)`
- `preloadImage(href, options)`

Use already-resolved URLs. This package does not look up logical pack names such
as `generated/WelcomePage.css`; resolve those through the host app's manifest or
React on Rails integration before calling the helper. That keeps the RSC package
independent of Rails and manifest formats while still supporting hashed
production assets.

## Choosing Hints

Use hints only for resources that are genuinely needed for the first viewport or
for early interaction:

- Use `preinitStyle` for critical CSS that should participate in React's
  stylesheet precedence and streamed boundary reveal behavior. By default it
  uses this package's `rsc-css` precedence bucket, the same bucket used for
  automatically discovered client-reference CSS. Pass an explicit `precedence`
  when author-critical CSS must be ordered separately.
- Use `preloadStyle` when you only need to start downloading a stylesheet early.
- Use `preloadFont` for fonts used by the LCP text. Include the real production
  font URL and `type`, for example `font/woff2`.
- Use `preloadImage` with `fetchPriority: 'high'` only for the actual LCP image,
  not for below-the-fold gallery or avatar images.
- Use `preconnect` for a CDN or asset origin that will certainly be used on the
  page. Use `prefetchDNS` when you only need the cheaper DNS lookup.
- Avoid preloading route chunks, below-the-fold images, optional third-party
  scripts, or assets that are already guaranteed by the page shell unless a
  measurement shows they are late.

Over-preloading can regress the same metrics this feature is intended to fix by
competing with critical CSS, fonts, or the real LCP resource.

## Verifying

Use Lighthouse, ShakaPerf, or Chrome DevTools on production-like hashed assets:

1. Confirm the LCP element. Check whether it is text, an image, or a client
   component boundary.
2. In the Network panel, filter downloads before LCP. Verify only the intended
   CSS, font, image, script, preconnect, or DNS hints moved earlier.
3. For text LCP, inspect layout shifts and font swaps. If font loading causes
   CLS or delays the LCP text, preload only the exact font weights used above
   the fold.
4. For image LCP, confirm the real LCP image has high priority and below-the-fold
   images remain lazy or low priority.
5. Compare FCP, Speed Index, LCP, TBT, total JS bytes, total downloads, and
   request count against the SSR or previous RSC baseline.
6. Remove any hint that does not improve the measured bottleneck.
