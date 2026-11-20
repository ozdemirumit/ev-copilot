# AGENTS.md

Bu depodaki tüm ajanlar için geçerli kurallar [`CLAUDE.md`](CLAUDE.md) dosyasındadır. Herhangi bir değişiklikten önce onu oku ve uygula.

Özet: her şey `main` üzerinden, Beta kullanılmaz (taban `origin/main`; eski `design/modern-ui-soc` yerel ağacı kullanılmaz; push sonrası canlı doğrulama zorunlu); önce `git status` + `docs/BETA_TASK_REGISTRY.md` denetimi, iş yapılmışsa NO-CHANGE; en küçük diff; testleri silme/zayıflatma; başkasının commit edilmemiş işine dokunma (stash/reset/clean yok); gizli bilgi gösterme; ücretli API, silme ve geri dönüşü zor işler için açık onay; gönderim ile doğrulanmış tamamlanmayı ayır.
