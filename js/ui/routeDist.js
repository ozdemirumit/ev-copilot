// İstasyonun aktif rotada araçtan kalan mesafesi (v0.99.104). İstasyonlar listesindeki "… km ileride" ile istasyon ayrıntı kartı
// aynı değeri, aynı biçimle gösterir. Yeni hesap yok: planlayıcının verdiği rota km'si (plan.stops / plan.stations) − progressKm().

export const BEHIND_KM = 0.3; // listeyle aynı: bundan fazla geride kalan istasyon gösterilmez

/** Liste biçimi: tam km, negatif değil (stationsView "… km ileride"). */
export const aheadKmText = (stKm, here) => Math.max(0, stKm - here).toFixed(0);

/** Bu istasyonun plandaki rota km'si (önce durak, sonra rotadaki adaylar); rota yoksa, rotada değilse ya da geride kaldıysa null. */
export function routeStationKm(plan, id, here) {
  if (!plan?.profile) return null;
  const km = (plan.stops || []).find((x) => x.station?.id === id)?.km ?? (plan.stations || []).find((x) => x.id === id)?.km;
  return Number.isFinite(km) && km > here - BEHIND_KM ? km : null;
}
