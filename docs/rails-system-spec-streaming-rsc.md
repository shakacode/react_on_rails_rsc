# Rails System Specs for Streamed RSC Payloads

`react-on-rails-rsc` does not contain a Rails app, Capybara setup, or Puffing
Billy setup. Use this guide in downstream Rails apps that consume the package
through `react_on_rails` and `react-on-rails-pro` and need browser specs for
pages that fetch streamed RSC payloads such as `/rsc_payload`.

## Transport Requirement

The RSC payload request must reach the browser as the live response from the
Rails app or node-renderer path. Do not stub, cache, replay, or buffer that
request in a browser proxy. If the payload is buffered until completion, the
browser-side RSC client may never observe the chunks that unblock hydration and
the system spec can hang even though the server generated a valid response.

Common symptoms:

- the page HTML renders, but the browser never reaches the hydrated state;
- the RSC payload request stays `inflight` or completes only after the spec
  times out;
- browser console logs show a pending Flight decode or missing client reference
  after the payload route returned successfully on the server.

## Recommended Capybara Shape

Use a non-Billy browser driver for specs that assert streamed RSC behavior. Keep
Puffing Billy for specs that need browser-side external request stubbing and do
not depend on RSC payload streaming.

```ruby
# spec/support/capybara_rsc_streaming.rb
Capybara.register_driver :selenium_chrome_rsc_streaming do |app|
  options = Selenium::WebDriver::Chrome::Options.new
  options.add_argument("--headless=new") if ENV["HEADLESS"] != "false"
  options.add_argument("--disable-dev-shm-usage")
  options.add_argument("--no-sandbox") if ENV["CI"]

  Capybara::Selenium::Driver.new(app, browser: :chrome, options: options)
end
```

```ruby
RSpec.describe "public RSC pages", type: :system, js: true do
  driven_by :selenium_chrome_rsc_streaming

  it "hydrates the streamed RSC payload" do
    visit "/"

    expect(page).to have_css("[data-rsc-ready='true']")
  end
end
```

Use an app-specific ready marker. The important assertion is that the browser
finished consuming the Flight payload, not merely that the initial static HTML
was present.

## Puffing Billy Compatibility

Puffing Billy is an HTTP proxy for browser requests. The
[Puffing Billy README](https://github.com/oesmith/puffing-billy) documents that
unstubbed requests are still proxied to the remote server, and that requests
routed through the proxy can be cached depending on configuration. It also
documents request log handlers such as `proxy`, `stubs`, `cache`, `error`, and
`inflight`.

That model is useful for external browser API calls, but it is a poor default
for streamed RSC payload routes. For specs that must verify streaming:

- do not run the spec with a `_billy` Capybara driver;
- do not stub the RSC payload URL;
- keep RSC payload paths out of `path_blacklist`, `cache_whitelist`,
  `merge_cached_responses_whitelist`, and any persistent cache fixtures. In
  current Puffing Billy, `path_blacklist` is a cache opt-in for specific paths,
  including otherwise whitelisted local paths; it is not route-level browser
  proxy bypass;
- do not treat Billy `whitelist` entries as streaming proof. Whitelisting keeps
  local app URLs from being cached by default, but the browser request can still
  be routed through the proxy layer;
- if a spec needs both external browser stubs and streamed RSC payloads, prefer
  server-side stubs in the Rails process, a local fake service, or a separate
  non-Billy spec for the RSC assertion.

For remote Chrome, proxy bypass rules are host-oriented rather than route-aware.
Bypassing the Capybara app host can keep `/rsc_payload` out of the Billy proxy,
but it also means Billy will not observe other browser requests to that same app
host. Prefer registering a dedicated non-Billy RSC driver unless the suite has a
well-tested reason to share the Billy driver.

When diagnosing an existing Billy-backed spec, temporarily enable request
recording and inspect the Billy log. A streamed RSC payload that is handled by
`cache`, `stubs`, `error`, or remains `inflight` is not a passing transport
setup. A `proxy` handler is better, but still needs an end-to-end hydration
assertion because proxying alone does not prove chunk delivery.

## Downstream Verification

This package can validate the JavaScript/Flight stream behavior with local Jest
and package E2E tests, but Rails proxy behavior must be verified in a downstream
Rails app.

Use the downstream gate when validating package changes against React on Rails:

```bash
yarn test:e2e:downstream -- --react-on-rails-ref main
```

For app-specific system specs, add a focused downstream test that:

1. visits the RSC route with the non-Billy streaming driver;
2. waits for an app-owned hydrated marker or visible client-island behavior;
3. confirms the RSC payload route was served by the app under test, not a
   Billy stub/cache;
4. keeps external API stubbing separate from the RSC payload transport check.

If the app can only reproduce the failure with Puffing Billy in front of the
RSC payload route, keep the system spec skipped or marked pending and link the
skip to the app-specific proxy limitation. Do not treat a buffered proxy path as
a supported RSC transport.
