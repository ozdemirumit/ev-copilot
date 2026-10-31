// Çevrimdışı harita kartı (yalnızca Alternatif kaynak seçiliyken görünen ayarlar içinde): R2 adresi, indir/durdur/sil, harita modu.
import { getSource } from '../providers/index.js';
import { save } from '../utils/storage.js';
import { COUNTRIES, mapBase, setMapBase, supported, packInfo, partialBytes, storageInfo, downloadPack, cancelDownload, downloading, deletePack, fmtMb } from '../offline/pack.js';
import { mapMode } from './maps/maplibre.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);

export function initOfflinePanel() {
  if (getSource() !== 'osm') return;
  const country = COUNTRIES[0];
  const status = $('map-pack-status');
  const dl = $('map-pack-dl');
  const del = $('map-pack-del');
  const bar = $('map-pack-bar');
  const base = $('map-base');
  const mode = $('map-mode');
  base.value = mapBase();
  mode.value = mapMode();

  async function paint(note = '') {
    const info = packInfo(country.id);
    const part = info ? 0 : await partialBytes(country.id);
    const st = await storageInfo();
    const free = st ? ` · boş yer ~${fmtMb(Math.max(0, st.free))}` : '';
    if (!supported()) status.textContent = 'Bu tarayıcı çevrimdışı harita saklamayı desteklemiyor.';
    else if (note) status.textContent = note;
    else if (info) status.textContent = `✅ ${country.name} indirildi (${fmtMb(info.size)}${info.build ? `, yapı ${info.build}` : ''}${info.maxzoom ? `, yakınlaştırma ${info.maxzoom}'e kadar` : ''})${free}`;
    else if (part) status.textContent = `Yarım indirme var (${fmtMb(part)}), devam edebilir${free}`;
    else status.textContent = `${country.name} indirilmedi${free}`;
    dl.disabled = !supported();
    dl.textContent = downloading() ? '⏸ Durdur' : info ? '↻ Güncelle' : part ? '⬇️ Devam et' : `⬇️ Haritayı indir (${country.name})`;
    del.classList.toggle('hidden', !info && !part && !downloading());
  }

  base.addEventListener('change', () => { setMapBase(base.value); base.value = mapBase(); });
  mode.addEventListener('change', () => {
    save('mapMode', mode.value);
    toast('Harita kaynağı değişti, sayfa yenileniyor');
    setTimeout(() => location.reload(), 900);
  });

  dl.addEventListener('click', async () => {
    if (downloading()) { cancelDownload(); return; }
    setMapBase(base.value);
    bar.classList.remove('hidden');
    bar.value = 0;
    dl.textContent = '⏸ Durdur';
    try {
      await downloadPack(country.id, ({ pos, size }) => {
        bar.value = (pos / size) * 100;
        status.textContent = `İndiriliyor %${Math.floor((pos / size) * 100)} · ${fmtMb(pos)} / ${fmtMb(size)} · uygulamayı açık tut`;
      });
      toast('Çevrimdışı harita indirildi');
      await paint();
    } catch (err) {
      await paint(err.message === 'iptal' ? 'Durduruldu: "Devam et" ile kaldığı yerden sürer' : `⚠️ ${err.message}`);
    } finally {
      bar.classList.add('hidden');
      dl.textContent = packInfo(country.id) ? '↻ Güncelle' : '⬇️ Devam et';
    }
  });

  del.addEventListener('click', async () => {
    if (downloading()) cancelDownload();
    if (!confirm(`${country.name} haritası (indirilen ve yarım dosyalar) silinsin mi?`)) return;
    await deletePack(country.id);
    toast('Çevrimdışı harita silindi');
    paint();
  });

  paint();
}
