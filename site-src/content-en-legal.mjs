// English privacy policy and account deletion page. Mirrors content-tr-legal.mjs; keep both in sync with what the app and server really do.
const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${d}, ${y}`; };

const privacy = (cfg) => `
    <section class="block" style="border:0">
      <div class="wrap doc">
        <h1>Privacy policy</h1>
        <p class="meta">Last updated: ${fmt(cfg.updated)}</p>
        <p>EV Route Finder (the “app”) is a route and charging planner for electric car drivers. This page explains what data we process, why, who we share it with, and your rights. The app has no ads, analytics or tracking tools, uses no cookies, and your data is not sold.</p>
        <p>I am the individual who develops and operates the app, and the data controller. Contact: <a href="mailto:${cfg.email}">${cfg.email}</a></p>

        <h2>In short</h2>
        <ul>
          <li>The app works without an account. If you sign in, your email address and name are stored.</li>
          <li>Your GPS location is processed on your device and is not streamed to our server. Location is sent only with the relevant request when you plan a route, search for stations or submit a report.</li>
          <li>Camera images (battery reading) never leave your device.</li>
          <li>The app does not collect location in the background.</li>
          <li>You can delete your account and its data from within the app.</li>
        </ul>

        <h2>Data we process</h2>
        <table>
          <thead><tr><th>Data</th><th>When and why</th></tr></thead>
          <tbody>
            <tr><td><b>Account:</b> email, name, Google account ID, creation and last sign-in time, Premium expiry date</td><td>When you sign in with Google, to provide your account. Your profile picture is not stored.</td></tr>
            <tr><td><b>Session:</b> a random session token</td><td>To keep you signed in. The server stores only a hash of the token; it is valid for 180 days.</td></tr>
            <tr><td><b>Synced data:</b> settings, vehicle profile, saved places and recent destinations, your own stations, operator prices, trip and charging history</td><td>When you sign in, to sync settings and history across devices. History records contain start and end locations at about 11 metres precision, duration, energy and temperature.</td></tr>
            <tr><td><b>Device record:</b> a random ID generated on your device, app version, platform (web or Android), first and last seen time</td><td>To count usage and prevent abuse. Your IP address is not stored in this record. Records not linked to an account are deleted after 90 days.</td></tr>
            <tr><td><b>Community contributions:</b> price reports (station location and kWh price), “I am charging here” reports, ratings, amenity votes (restroom, cafe, etc.), station photos</td><td>Only if you submit them. Other signed-in users see aggregated ratings, votes and photos; who submitted them is not shown. The “charging” report can be turned off in settings, is reduced to an area of about 100 metres and removed after 3 hours; home and work locations are not sent. Location (EXIF) data is removed from photos; avoid capturing people or number plates.</td></tr>
            <tr><td><b>Server logs:</b> IP address, time, request path and status code</td><td>For security and debugging. Query parameters such as coordinates are not written to the logs.</td></tr>
          </tbody>
        </table>

        <h2>Location and camera</h2>
        <p><b>Location.</b> If you do not grant location permission, the app cannot know your position; you can still plan using points you enter. When you allow it, your GPS position stays on your device. Only the coordinates a given request needs are sent to our server or to the services below (for example a route's start and end, or stations around you).</p>
        <p><b>Camera.</b> For Premium users, the battery-percentage reader processes images on your device (the reading engine ships with the app). Images are not uploaded anywhere. The only thing you capture and upload is a station photo you choose yourself.</p>

        <h2>Services your data goes to</h2>
        <p>We use third-party services for route and station data. The table shows who receives what; each service's own privacy policy also applies (for example <a href="https://policies.google.com/privacy" rel="noopener">Google</a>).</p>
        <table>
          <thead><tr><th>Service</th><th>Purpose</th><th>What is sent</th></tr></thead>
          <tbody>
            <tr><td colspan="3"><b>Through our server</b> (the service sees our server's address, not your IP address)</td></tr>
            <tr><td>Mapbox</td><td>Routing and station search</td><td>Route points, search-centre coordinates</td></tr>
            <tr><td>HERE</td><td>Station search; Premium: road speed limits</td><td>Search centre and radius; points sampled from the route</td></tr>
            <tr><td>OpenChargeMap, Overpass (OpenStreetMap), NDW</td><td>Station data, live occupancy</td><td>Area coordinates</td></tr>
            <tr><td>Google Places</td><td>Premium: live occupancy (only on low battery)</td><td>Station coordinates</td></tr>
            <tr><td>Sign in with Google</td><td>Sign-in</td><td>Email and name (as shared by Google)</td></tr>
            <tr><td>Email service (SMTP)</td><td>Invitation emails</td><td>Recipient address and invitation text</td></tr>
            <tr><td colspan="3"><b>Directly from your device</b> (the service sees your IP address)</td></tr>
            <tr><td>Valhalla (OpenStreetMap / FOSSGIS)</td><td>Routing and elevation</td><td>Start, via and end coordinates</td></tr>
            <tr><td>Open-Meteo</td><td>Weather and elevation</td><td>Route points and times</td></tr>
            <tr><td>Photon (Komoot), Nominatim (OpenStreetMap)</td><td>Place search</td><td>The text you type and an approximate position; coordinates for address lookup</td></tr>
            <tr><td>OpenFreeMap, Esri (satellite imagery)</td><td>Map tiles</td><td>Your IP address and the area you view</td></tr>
            <tr><td>Mapbox or Google Maps (only if assigned to you)</td><td>Map</td><td>Your IP address and the area you view</td></tr>
            <tr><td>ABRP (A Better Routeplanner)</td><td>Premium: live telemetry, only if you turn it on</td><td>Battery, speed, location, elevation, outside temperature</td></tr>
            <tr><td>GitHub Pages</td><td>Serves the web app files (the Android app loads them too)</td><td>Your IP address</td></tr>
          </tbody>
        </table>
        <p>If you enter your own API key or your own webhook address, the related requests go directly to that service.</p>

        <h2>How long we keep data</h2>
        <ul>
          <li>Account, synced data, history, ratings and photos: until you delete them or your account.</li>
          <li>Session: 180 days. Device record not linked to an account: 90 days. Price reports: at most 90 days. “Charging” report: 3 hours.</li>
          <li>Backups: the 14 most recent daily backups of the data file are kept. A deleted account can remain in backups for about 14 days.</li>
          <li>Server logs (IP, time, path): kept in files that rotate by size; no separate retention period is defined.</li>
        </ul>

        <h2>Deleting your account and your rights</h2>
        <p>You can delete your account from the app: <b>More &gt; Account &gt; Delete account</b>. Details, and an email route for people who cannot access the app, are on the <a href="/en/delete-account/">account deletion page</a>.</p>
        <p>You have the right to access, correct, delete, object to the processing of, and port your personal data (under GDPR and Turkish KVKK article 11). Just write to <a href="mailto:${cfg.email}">${cfg.email}</a>. If you get no answer, you can complain to the data protection authority in your country.</p>
        <p>We process data to provide your account (performance of a contract), for security (legitimate interest), and for location, camera and photo uploads on the basis of your consent (you grant permission and can withdraw it at any time).</p>

        <h2>Security</h2>
        <p>Data is transmitted over HTTPS. Session tokens are stored on the server only as a hash. The server is a computer operated by the developer with restricted access; still, no system can be called completely secure. If you notice a security problem, please report it to <a href="mailto:${cfg.email}">${cfg.email}</a>.</p>

        <h2>Children</h2>
        <p>The app is not directed at children under 13, and we do not knowingly collect data from them.</p>

        <h2>Changes</h2>
        <p>If the app starts processing new data, we will update this page and the date at the top will change.</p>
      </div>
    </section>`;

const del = (cfg) => `
    <section class="block" style="border:0">
      <div class="wrap doc">
        <h1>Delete your account</h1>
        <p class="meta">Last updated: ${fmt(cfg.updated)}</p>
        <p>You can delete your EV Route Finder account and the data linked to it at any time.</p>

        <h2>Delete from the app</h2>
        <ol>
          <li>Open the <b>More</b> tab in the app.</li>
          <li>On the <b>Account</b> card, tap <b>Delete account</b> and confirm.</li>
        </ol>

        <h2>If you cannot access the app</h2>
        <p>From the Google address linked to your account, send an email titled “Account deletion” to <a href="mailto:${cfg.email}?subject=Account%20deletion">${cfg.email}</a>. I will verify the request and delete your account within 30 days.</p>

        <h2>What is deleted</h2>
        <ul>
          <li>Your account record (email, name, Google account ID) and all your sessions.</li>
          <li>Your synced settings, saved places, your own stations, and trip and charging history.</li>
          <li>Your price reports, “charging” reports, ratings, amenity votes and the station photos you uploaded.</li>
          <li>The device record linked to your account (if it is not linked to another account).</li>
        </ul>

        <h2>What remains</h2>
        <ul>
          <li><b>Backups:</b> the 14 most recent daily backups of the data file; a deleted account can remain in them for about 14 days, then is removed automatically.</li>
          <li><b>Server logs</b> (IP, time, request path): not linked to your account; kept in files that rotate by size.</li>
          <li><b>Anonymous counters:</b> request counts sent to providers remain as anonymous totals.</li>
          <li><b>Local data on your device:</b> removed when you uninstall the app or clear browser data.</li>
        </ul>
        <p>For more information see the <a href="/en/privacy/">privacy policy</a>.</p>
      </div>
    </section>`;

export function legalEn(cfg) {
  return [
    { key: 'privacy', lang: 'en', path: '/en/privacy/', title: 'Privacy policy · EV Route Finder', desc: 'What data EV Route Finder processes, who it is shared with, how long it is kept, and how to delete your account.', body: privacy(cfg) },
    { key: 'delete', lang: 'en', path: '/en/delete-account/', title: 'Delete your account · EV Route Finder', desc: 'How to delete your EV Route Finder account and data.', body: del(cfg) },
  ];
}
