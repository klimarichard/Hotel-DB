# Příručka — Účetní

Jako **účetní** máte v systému HPM Intranet **přístup pouze pro čtení**. Vidíte dvě oblasti — **Přehled** (statistiky personálu) a **Zaměstnance** (náhled, odhalení citlivých údajů, stažení smluv a export dat). Nic neupravujete ani nepřidáváte.

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Přihlášení](#přihlášení)
- [Přehled](#přehled)
- [Zaměstnanci](#zaměstnanci)

---

## Přihlášení

Aplikace je dostupná v prohlížeči. Přihlašujete se **uživatelským jménem a heslem**.

- Stačí zadat samotné uživatelské jméno (např. `vondra`) — doména `@hotel.local` se doplní automaticky. Funguje i zadání celého e-mailu.
- **Zapomenuté heslo:** na přihlašovací obrazovce klikněte na *„Zapomenuté heslo?"* a na váš e-mail přijde odkaz pro nastavení nového hesla.
- Administrátor vám může poslat odkaz pro reset hesla, případně vytvořit účet bez hesla — pak si při prvním přihlášení heslo zvolíte sami.

> 📷 *(Místo pro snímek obrazovky: přihlašovací formulář)*

Vlevo dole je vždy vidět **jméno přihlášeného uživatele**; tlačítkem *Odhlásit* se odhlásíte. Vedle je přepínač **světlého/tmavého režimu**.

---

## Přehled

Úvodní stránka po přihlášení. Jako účetní zde vidíte **pouze statistickou část** o personálu:

- rychlé statistiky personálu — počty, věkové složení, národnosti a pozice.

Směnové informace (kdo má dnes směnu, kdo je vedoucí směny, nepřítomní FOM) se vám nezobrazují.

> 📷 *(Místo pro snímek obrazovky: Přehled)*

---

## Zaměstnanci

Evidence všech zaměstnanců — **vše jen pro čtení**. Záložky **Aktivní** a **Ukončení** přepínají mezi zaměstnanci v pracovním poměru a ukončenými.

### Vyhledávání a seznam

- Vyhledávací pole hledá podle jména, příjmení, **rodného příjmení**, pozice i národnosti.
- Řádky jsou barevně odlišené podle typu smlouvy (HPP / PPP / DPP).
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky.

> 📷 *(Místo pro snímek obrazovky: seznam zaměstnanců)*

### Detail zaměstnance

Detail má dvě hlavní části — **Detail** (osobní a kontaktní údaje) a **Historie pracovního poměru**. Údaje pouze prohlížíte, nic neupravujete.

- **Citlivé údaje** (rodné číslo, číslo OP, číslo pojištěnce, bankovní účet) jsou skryté; zobrazíte je kliknutím na ikonu oka. **Každé zobrazení se zaznamenává do logu změn.**

> 📷 *(Místo pro snímek obrazovky: detail zaměstnance)*

#### Historie pracovního poměru

Pracovní poměr je členěn na **sezení (sessions)** — každé začíná **Nástupem**, může obsahovat **Dodatky** (změna mzdy, pozice, úvazku, délky smlouvy) a končí **Ukončením**.

- Mzda a pozice v záhlaví poměru se mění až **k datu platnosti Dodatku**.
- **Automatický přesun do „Ukončení":** zaměstnanec se do záložky *Ukončení* přesune sám, jakmile **uplyne datum ukončení** (smlouva na dobu určitou nebo zadané ukončení). Den ukončení je ještě aktivní — přesun proběhne až následující den. Naopak **budoucí Nástup** zaměstnance aktivuje **až v den nástupu**.
- U řádků historie si můžete **vygenerovanou smlouvu zobrazit a stáhnout** pod čitelným názvem.
