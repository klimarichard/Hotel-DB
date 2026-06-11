# Příručka — Účetní

Jako **účetní** máte v systému HPM Intranet **přístup pouze pro čtení**. Vidíte dvě oblasti — **Přehled** (statistiky personálu) a **Zaměstnance** (náhled, odhalení citlivých údajů, stažení smluv a export dat). Nic neupravujete ani nepřidáváte.

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Průvodce a Nápověda](#průvodce-a-nápověda)
- [Přihlášení](#přihlášení)
- [Přehled](#přehled)
- [Zaměstnanci](#zaměstnanci)

---

## Průvodce a Nápověda

Při **prvním přihlášení** se automaticky spustí interaktivní **Prohlídka aplikace** — průvodce, který vás krok po kroku provede těmi částmi aplikace, ke kterým máte přístup. Průvodce je přizpůsobený právě vašim oprávněním: uvidíte jen kroky relevantní pro váš účet.

- Průvodce můžete kdykoli přerušit tlačítkem **Přeskočit**.
- V záhlaví každého vyskakovacího okénka průvodce je vedle čítače kroků (např. „Krok 2 z 5") zobrazen název aktuální sekce. Pomocí tlačítek **„‹ Předchozí sekce"** a **„Další sekce ›"** můžete přeskočit celou sekci najednou — rychlé přesměrování bez procházení každého kroku.
- Pokud se po přihlášení do aplikace přidají nové funkce, průvodce vás krátce uvítá oznámením **„Co je nového"** a ukáže jen kroky týkající se těchto novinek — celou prohlídku znovu absolvovat nemusíte.
- Chcete-li si celou prohlídku zopakovat, klikněte vlevo dole na tlačítko **„? Nápověda"**. Otevře se stránka **Nápověda**, kde najdete tlačítko pro opětovné spuštění průvodce a přehled sekcí aplikace, ve kterém lze vyhledávat.

> 📷 *(Místo pro snímek obrazovky: tlačítko Nápověda v levém dolním rohu)*

---

## Přihlášení

Aplikace je dostupná v prohlížeči. Přihlašujete se **uživatelským jménem a heslem**.

- Stačí zadat samotné uživatelské jméno (např. `vondra`) — doména `@hotel.local` se doplní automaticky. Funguje i zadání celého e-mailu.
- **Zapomenuté heslo:** na přihlašovací obrazovce klikněte na *„Zapomenuté heslo?"* a na váš e-mail přijde odkaz pro nastavení nového hesla.
- Administrátor vám může poslat odkaz pro reset hesla, případně vytvořit účet bez hesla — pak si při prvním přihlášení heslo zvolíte sami.

> 📷 *(Místo pro snímek obrazovky: přihlašovací formulář)*

Vlevo dole je vždy vidět **jméno přihlášeného uživatele**. Pod ním jsou tři tlačítka v pořadí: přepínač **světlého/tmavého režimu** → **? Nápověda** → **Odhlásit**.

---

## Přehled

Úvodní stránka po přihlášení. Jako účetní zde vidíte **pouze statistickou část** o personálu:

- rychlé statistiky personálu — počty, věkové složení, národnosti a pozice.

Směnové informace (kdo má dnes směnu, kdo je vedoucí směny, nepřítomní FOM) se vám nezobrazují.

> 📷 *(Místo pro snímek obrazovky: Přehled)*

---

## Zaměstnanci

Evidence všech zaměstnanců — **vše jen pro čtení**. Záložky **Aktivní**, **Před nástupem** a **Ukončení** přepínají mezi zaměstnanci v pracovním poměru, nadcházejícími a ukončenými.

### Vyhledávání a seznam

- Vyhledávací pole hledá podle jména, příjmení, **rodného příjmení**, pozice i národnosti.
- Řádky jsou barevně odlišené podle typu smlouvy (HPP / PPP / DPP).
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky.

> 📷 *(Místo pro snímek obrazovky: seznam zaměstnanců)*

### Detail zaměstnance

Detail má tři záložky — **Detail** (osobní a kontaktní údaje), **Historie pracovního poměru** a **Další dokumenty**. Údaje pouze prohlížíte, nic neupravujete.

- **Citlivé údaje** (rodné číslo, číslo OP, číslo pojištěnce, bankovní účet) jsou skryté; zobrazíte je kliknutím na ikonu oka. **Každé zobrazení se zaznamenává do logu změn.**
- Tlačítko **Dotazník** v záhlaví okamžitě otevře v nové záložce prohlížeče vyplněný **Osobní dotazník zaměstnance** (PDF) se všemi aktuálními údaji zaměstnance připravenými k tisku. Soubor se nikam nestahuje — pouze se zobrazí v nové záložce. Dotazník obsahuje citlivé údaje (rodné číslo atp.) a jeho vygenerování se zaznamenává do **Logu změn**.

> 📷 *(Místo pro snímek obrazovky: detail zaměstnance)*

#### Historie pracovního poměru

Pracovní poměr je členěn na **sezení (sessions)** — každé začíná **Nástupem**, může obsahovat **Dodatky** (změna mzdy, pozice, úvazku, délky smlouvy) a končí **Ukončením**.

- Mzda a pozice v záhlaví poměru se mění až **k datu platnosti Dodatku**.
- **Automatický přesun do „Ukončení":** zaměstnanec se do záložky *Ukončení* přesune sám, jakmile **uplyne datum ukončení** (smlouva na dobu určitou nebo zadané ukončení). Den ukončení je ještě aktivní — přesun proběhne až následující den. Naopak zaměstnanec s budoucím nástupem se zobrazuje v záložce **Před nástupem** a do záložky **Aktivní** se přesune automaticky **v den nástupu**.
- U řádků historie si můžete **vygenerovanou smlouvu zobrazit a stáhnout** pod čitelným názvem.

#### Další dokumenty

Záložka **Další dokumenty** zobrazuje přílohy nahrané k zaměstnanci. Dokumenty zde pouze prohlížíte a stahujete, nic nenahráváte ani nemažete.

##### Prohlášení poplatníka

Tlačítko **Prohlášení poplatníka** (vlevo od **Nahrát dokument**) vygeneruje vyplněné **Prohlášení poplatníka daně** (formulář MFin 5457, PDF) a otevře ho v nové záložce prohlížeče.

Po kliknutí se nejprve zobrazí malý dialog. Do pole **Zdaňovací období** zadejte příslušné období — například `2026` (celý rok) nebo `od září 2026` (část roku). Potvrdíte tlačítkem **Generovat** a PDF se otevře v nové záložce připravené k tisku.

> 📝 **Upozornění:** Formulář je vyplněn z evidenčních údajů zaměstnance. Blok pro **daňového nerezidenta** (cizince, který nepodléhá zdanění v ČR) zůstane prázdný — tyto řádky musí zaměstnanec doplnit ručně. Dokument obsahuje citlivé údaje (rodné číslo atp.) a každé vygenerování se zaznamenává do **Logu změn**.

> 📷 *(Místo pro snímek obrazovky: záložka Další dokumenty s tlačítkem Prohlášení poplatníka)*
