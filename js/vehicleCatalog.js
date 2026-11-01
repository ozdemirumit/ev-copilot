// Hazır araç profilleri (marka › model › pil). TÜM DEĞERLER TAHMİNDİR (üretici verisi değil, doğrulanmadı): rakamlar yaklaşık,
// versiyonlar arasında değişir. Araç ve tüketim bölümünden her değer elle düzeltilebilir (düzeltince "Özel araç" olur).
// Alanlar: batteryNetKwh = net (kullanılabilir) kWh, massKg = yaklaşık boş ağırlık + sürücü, cd, frontalAreaM2 = ön alan,
// maxDcKw = tepe DC şarj gücü (CCS). Şarj eğrisi tepe güce göre ölçeklenir (routing/chargeCurve.js).
// Satır: [marka, model, pil/versiyon, net kWh, kg, Cd, ön alan m², tepe DC kW, (isteğe bağlı) true = tahmin değil]
const ROWS = [
  ['Togg', 'T10X V2', 'Uzun Menzil (88,5 kWh)', 88.5, 2150, 0.29, 2.55, 180, true],
  ['Togg', 'T10X V2', 'Standart Menzil (52,4 kWh)', 52.4, 1950, 0.29, 2.55, 150],
  ['Hyundai', 'Ioniq 5', '63 kWh', 58, 1950, 0.28, 2.65, 165],
  ['Hyundai', 'Ioniq 5', '77 kWh (2022-24)', 74, 2050, 0.288, 2.7, 235],
  ['Hyundai', 'Ioniq 5', '84 kWh (2025+)', 80, 2100, 0.283, 2.7, 235],
  ['Hyundai', 'Ioniq 6', '77 kWh', 74, 1950, 0.21, 2.35, 235],
  ['Hyundai', 'Kona Electric', '65 kWh', 64, 1750, 0.29, 2.55, 100],
  ['Kia', 'EV6', '77 kWh', 74, 2050, 0.28, 2.6, 235],
  ['Kia', 'EV9', '100 kWh', 96, 2600, 0.28, 3.0, 210],
  ['Kia', 'Niro EV', '65 kWh', 64, 1750, 0.29, 2.6, 85],
  ['Tesla', 'Model 3', 'RWD', 57, 1765, 0.219, 2.22, 170],
  ['Tesla', 'Model 3', 'Long Range', 75, 1840, 0.219, 2.22, 250],
  ['Tesla', 'Model Y', 'RWD', 57, 1910, 0.23, 2.56, 175],
  ['Tesla', 'Model Y', 'Long Range', 75, 2000, 0.23, 2.56, 250],
  ['BYD', 'Dolphin', '60 kWh', 60, 1600, 0.29, 2.3, 80],
  ['BYD', 'Atto 3', '60 kWh', 60, 1750, 0.29, 2.6, 88],
  ['BYD', 'Seal', '82 kWh', 82, 2100, 0.219, 2.4, 150],
  ['MG', 'MG4', '64 kWh', 62, 1650, 0.27, 2.3, 135],
  ['MG', 'MG4', '77 kWh', 74, 1800, 0.27, 2.3, 144],
  ['MG', 'ZS EV', 'Long Range', 68, 1700, 0.3, 2.6, 92],
  ['Renault', 'Megane E-Tech', '60 kWh', 60, 1750, 0.29, 2.5, 130],
  ['Renault', '5 E-Tech', '52 kWh', 52, 1500, 0.3, 2.2, 100],
  ['Peugeot', 'e-208', '51 kWh', 48, 1550, 0.29, 2.2, 100],
  ['Peugeot', 'e-2008', '54 kWh', 51, 1700, 0.3, 2.5, 100],
  ['Citroën', 'ë-C4', '54 kWh', 50, 1700, 0.29, 2.5, 100],
  ['Fiat', '500e', '42 kWh', 37, 1300, 0.31, 2.2, 85],
  ['Volkswagen', 'ID.3', 'Pro 58 kWh', 58, 1810, 0.267, 2.36, 120],
  ['Volkswagen', 'ID.4', 'Pro 77 kWh', 77, 2120, 0.28, 2.77, 150],
  ['Volkswagen', 'ID.7', 'Pro 77 kWh', 77, 2100, 0.23, 2.5, 175],
  ['Škoda', 'Enyaq', '85 (77 kWh net)', 77, 2100, 0.27, 2.7, 135],
  ['Škoda', 'Elroq', '85 (77 kWh net)', 77, 1900, 0.26, 2.4, 175],
  ['Cupra', 'Born', '58 kWh', 58, 1800, 0.27, 2.35, 120],
  ['Audi', 'Q4 e-tron', '77 kWh', 77, 2150, 0.28, 2.7, 135],
  ['Porsche', 'Taycan', '4 (93 kWh brüt)', 79, 2200, 0.22, 2.3, 270],
  ['BMW', 'i4', 'eDrive40 (81 kWh)', 80, 2050, 0.24, 2.4, 205],
  ['BMW', 'iX1', 'xDrive30 (65 kWh)', 64, 2000, 0.26, 2.6, 130],
  ['BMW', 'iX3', '80 kWh', 74, 2200, 0.29, 2.7, 150],
  ['Mini', 'Cooper SE', '2024 (54 kWh brüt)', 49, 1600, 0.28, 2.2, 95],
  ['Mercedes', 'EQA', '250 (66,5 kWh)', 66, 2100, 0.28, 2.6, 100],
  ['Mercedes', 'EQB', '250+ (66,5 kWh)', 66, 2150, 0.28, 2.7, 100],
  ['Mercedes', 'EQE', '350+ (90 kWh)', 90, 2350, 0.22, 2.4, 170],
  ['Volvo', 'EX30', '69 kWh', 64, 1900, 0.28, 2.4, 153],
  ['Volvo', 'XC40 Recharge', '78 kWh', 75, 2150, 0.31, 2.6, 150],
  ['Polestar', 'Polestar 2', 'Long Range', 75, 2100, 0.27, 2.4, 205],
  ['Nissan', 'Leaf', '62 kWh', 59, 1750, 0.28, 2.3, 100],
  ['Nissan', 'Ariya', '87 kWh', 87, 2200, 0.297, 2.7, 130],
  ['Smart', '#1', '66 kWh', 62, 1820, 0.29, 2.5, 150],
  ['Ford', 'Mustang Mach-E', 'Extended Range', 88, 2200, 0.28, 2.7, 150],
];

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const CATALOG = ROWS.map(([brand, model, pack, batteryNetKwh, massKg, cd, frontalAreaM2, maxDcKw, known]) => ({
  id: slug(`${brand}-${model}-${pack}`),
  brand, model, pack,
  name: `${brand} ${model} ${pack}${known ? '' : ' (tahmini)'}`,
  batteryNetKwh, massKg, cd, frontalAreaM2, maxDcKw,
}));

/** Eski sürümlerde kaydedilmiş araç kimlikleri yeni kataloğa eşlenir. */
export const LEGACY_IDS = { 'togg-v2-lr': 'togg-t10x-v2-uzun-menzil-88-5-kwh', 'togg-v2-sr': 'togg-t10x-v2-standart-menzil-52-4-kwh' };
