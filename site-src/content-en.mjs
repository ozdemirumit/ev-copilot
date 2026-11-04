// English pages, served under /en/.
import { icons, routeArt } from './layout.mjs';
import { legalEn } from './content-en-legal.mjs';

const home = (cfg) => `
    <section class="hero">
      <div class="wrap">
        <div>
          <p class="eyebrow">Electric car route planner</p>
          <h1>A realistic route plan, charging stops included</h1>
          <p class="lead">EV Route Finder estimates your range from speed, slope, wind, temperature and traffic, and places charging stops along the route. Try it in your browser, no installation needed.</p>
          <div class="cta">
            <a class="btn btn-primary" href="${cfg.appUrl}">Open the app</a>
            <a class="btn btn-ghost" href="#download">Android and iPhone</a>
          </div>
          <p class="hint">Works without an account. Some features, such as the camera and ABRP, are available by invitation.</p>
        </div>
        ${routeArt({ label: 'Sample route: a plan from point A to point B with two charging stops', stop1: '⚡ 18 min', stop2: '⚡ 12 min', arrive: 'Arrival battery 24% (sample)', sample: 'illustrative sample' })}
      </div>
    </section>

    <section class="block" id="features">
      <div class="wrap">
        <h2>Plans the whole trip</h2>
        <p class="sub">It answers range anxiety with numbers: how far you can go, and where and how long to charge.</p>
        <div class="grid">
          <article class="card"><div class="ico">${icons.route}</div><h3>Realistic range</h3><p>Speed, road slope, wind, temperature, climate control and traffic are all taken into account. As you enter battery readings, it measures your car's real consumption and corrects the estimate.</p></article>
          <article class="card"><div class="ico">${icons.bolt}</div><h3>Multi-stop charging plan</h3><p>Pick your start and arrival battery; the planner works out the charging stops, charging times and arrival battery. The charging curve scales with your car's DC power.</p></article>
          <article class="card"><div class="ico">${icons.gauge}</div><h3>Charging stations</h3><p>Stations along your route and nearby, with power (kW), operator and estimated price. Add your own stations and edit operator prices.</p></article>
          <article class="card"><div class="ico">${icons.nav}</div><h3>Navigation and alerts</h3><p>Voice guidance, a 2D/3D map and road alerts such as ice risk. Premium accounts also see the road speed limit.</p></article>
          <article class="card"><div class="ico">${icons.camera}</div><h3>Camera and ABRP <span class="tag">Premium</span></h3><p>Your phone camera reads the battery percentage from the car's display; the reading happens on your device. You can also stream live telemetry to A Better Routeplanner.</p></article>
          <article class="card"><div class="ico">${icons.globe}</div><h3>11 languages, any device</h3><p>Available in 11 languages. It runs in the browser, can be added to the home screen, and has an Android app. It retries when the connection is weak.</p></article>
        </div>
      </div>
    </section>

    <section class="block" id="how">
      <div class="wrap">
        <h2>How it works</h2>
        <p class="sub">Your plan is ready in three steps.</p>
        <ol class="steps">
          <li><h3>Choose your car</h3><p>There are 48 ready-made profiles from 23 brands. Values are estimates; you can edit battery, weight and charging power to match your car.</p></li>
          <li><h3>Enter your route and battery</h3><p>Tell it where you are going and your current battery percentage. Weather and elevation profiles are added to the route automatically.</p></li>
          <li><h3>Follow the plan</h3><p>Charging stops, time and arrival battery are ready. Start navigation; the plan updates on the road based on your consumption.</p></li>
        </ol>
        <p class="note" style="margin-top:22px">Range, time and price figures are estimates and vary with the car, weather and road conditions. For important trips, double-check your charge level and station availability.</p>
      </div>
    </section>

    <section class="block" id="download">
      <div class="wrap">
        <h2>Download</h2>
        <p class="sub">The browser is the easiest way; on Android you can also install the app.</p>
        <div class="dl">
          <article class="card"><h3>Android</h3><p>Download the app directly as an APK. A Google Play version is on its way.</p><a class="btn btn-primary" href="${cfg.apkUrl}">Download APK</a><span class="btn btn-ghost off" aria-disabled="true">Google Play: coming soon</span></article>
          <article class="card"><h3>iPhone</h3><p>Open the app in Safari, tap the Share button and choose <b>Add to Home Screen</b>. Because of iOS limits, location and voice guidance stop when the screen is off.</p><a class="btn btn-ghost" href="${cfg.appUrl}">Open the app</a></article>
          <article class="card"><h3>Browser</h3><p>Works in Chrome, Edge and Safari; no installation or account needed. On a phone you can add it to the home screen.</p><a class="btn btn-ghost" href="${cfg.appUrl}">Open the app</a></article>
        </div>
      </div>
    </section>

    <section class="block" id="faq">
      <div class="wrap faq">
        <h2>Frequently asked questions</h2>
        <p class="sub">Short answers.</p>
        <details><summary>Do I need an account?</summary><p>No. Route planning, station search and navigation work without an account. Signing in with Google syncs your history and settings across devices; sign-in is currently by invitation. The camera, ABRP and Test Mode are available to Premium accounts.</p></details>
        <details><summary>How is my data used?</summary><p>Your location is sent through our server to map and data providers for route and station queries. Camera images never leave your device. See the <a href="/en/privacy/">privacy policy</a> for details and for how to delete your account.</p></details>
        <details><summary>Which cars are supported?</summary><p>There are 48 ready-made profiles from 23 brands, including Togg, Tesla, Hyundai, Kia, BYD and Volkswagen. Values are estimates; if your car is missing or different, you can edit every value.</p></details>
        <details><summary>Are you affiliated with Togg, ABRP or other brands?</summary><p>No. EV Route Finder is an independent project and is not affiliated with the brands mentioned.</p></details>
        <details><summary>I ran into a problem. Who do I contact?</summary><p>Write to <a href="mailto:${cfg.email}">${cfg.email}</a>. Including your device, the app version (the version card under More) and what happened makes it easier to fix.</p></details>
      </div>
    </section>`;

export function pages(cfg) {
  return [
    { key: 'home', lang: 'en', path: '/en/', title: 'EV Route Finder · Electric car route and charging planner', desc: 'An electric car route planner that accounts for speed, slope, wind and traffic: realistic range, charging stops and navigation. In your browser and on Android.', body: home(cfg) },
    ...legalEn(cfg),
  ];
}
