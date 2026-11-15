// Sağlayıcı istek korumacısını (js/net/providerGate.js) uygulamanın İLK modülü olarak kurar: js/app.js bunu ilk import eder,
// böylece başka hiçbir modül korumasız fetch çağıramaz. Engellenen istek ağa çıkmaz; konsola yalnızca neden ve sunucu adı yazılır.
import { installProviderGate } from './providerGate.js';
import { proxyBase } from './proxy.js';

installProviderGate(globalThis, {
  getProxyBase: proxyBase,
  onBlock: (reason, url) => { let host = ''; try { host = new URL(url, location.href).host; } catch { /* yoksay */ } console.info('[kota koruması] istek gönderilmedi:', reason, host); },
});
