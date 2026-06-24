# Příručka — Účetní

Jako **účetní** máte v systému HPM Intranet **přístup pouze pro čtení**. Vidíte tři oblasti — **Přehled** (statistiky personálu), **Zaměstnance** (náhled, odhalení citlivých údajů, stažení smluv a export dat) a **Log změn** (auditní historie akcí v systému). Nic neupravujete ani nepřidáváte.

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Průvodce a Nápověda](#průvodce-a-nápověda)
- [Přihlášení](#přihlášení)
- [Přehled](#přehled)
- [Zaměstnanci](#zaměstnanci)
- [Log změn](#log-změn)

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
- Vedle odznaku HPP/PPP/DPP může být u jména zaměstnance zobrazen zelený odznak **„V zácviku"** — ten signalizuje, že zaměstnanec je aktuálně v období zácviku. Odznak zmizí automaticky po uplynutí nastaveného data konce zácviku.
- U jména zaměstnance může být zobrazen i odznak **„Rodičovská"** — ten signalizuje, že zaměstnanec je aktuálně na rodičovské dovolené. Odznak se zobrazuje jen po dobu trvání zadaného období a poté automaticky zmizí.
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky.

#### Sloupce tabulky

Tabulka zaměstnanců zobrazuje tyto sloupce (zleva doprava):

**Jméno** (s odznakem HPP / PPP / DPP) · **Pozice** · **Oddělení** · **Národnost** · **Datum nástupu** · **Datum ukončení** · **Stav**

Dva sloupce stojí za bližší vysvětlení:

- **Datum nástupu** — zobrazuje, odkdy zaměstnanec **nepřetržitě** pracuje ve společnosti. Jde o začátek jeho nejdelšího nynějšího nepřerušeného pracovního poměru, nikoli datum poslední podepsané smlouvy. Příklad: zaměstnanec nastoupil v listopadu 2022 a od té doby pracuje bez přestávky (smlouvy na sebe navazovaly bez reálné mezery), sloupec zobrazí **listopad 2022** i v případě, že aktuální smlouva začala tento rok. Pokud ale zaměstnanec odešel a po čase nastoupil znovu po delší přestávce, zobrazí se datum **nového** nástupu.
- **Datum ukončení** — zobrazuje datum konce pracovního poměru, je-li známé. Sloupec je vyplněn u zaměstnanců v záložce **Ukončení** i u stále zaměstnaných osob s pevně sjednaným koncem smlouvy nebo předem zadaným ukončením. Zaměstnanci na dobu neurčitou bez zadaného ukončení mají v tomto sloupci pomlčku „—".

#### Řazení tabulky

Kliknutím na záhlaví sloupce seznam seřadíte. Opětovným kliknutím na stejné záhlaví pořadí obrátíte (vzestupně ↔ sestupně). Aktuálně aktivní řazení poznáte podle šipky **▲** nebo **▼** zobrazené přímo v záhlaví sloupce.

Řadit lze podle těchto sloupců: **Jméno** (podle příjmení), **Pozice**, **Oddělení**, **Národnost**, **Datum nástupu**, **Datum ukončení**. Sloupec **Stav** řaditelný není. Záznamy s prázdnou hodnotou se vždy zobrazují na konci seznamu. Ve výchozím stavu je seznam seřazen podle příjmení A→Z.

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

---

## Log změn

Úplná auditní historie všech akcí v systému — kdo co udělal a kdy. Jako účetní máte do Logu změn **přístup pouze pro čtení**: záznamy prohlížíte a filtrujete, ale nic v nich neupravujete.

> 📷 *(Místo pro snímek obrazovky: Log změn)*

### Co je zaznamenáno

Log zachycuje všechny typy akcí:

- **Vytvoření, úprava a smazání** zaměstnanců, pracovních poměrů, šablon smluv, nastavení apod.
- **Schválení a zamítnutí** — žádosti o dovolenou, o změnu směny nebo o úpravu profilu.
- **Převzetí volné směny**.
- **Odhalení citlivých údajů** — každé zobrazení rodného čísla, čísla OP, bankovního účtu apod. (citlivý obsah se v záznamu nikdy nezobrazuje, jen informace, že k odhalení došlo).
- **Akce systému** — automatické přechody stavů plánů, automatické ukončení pracovního poměru, automatické uzavření Multisportu a podobné operace prováděné na pozadí bez zásahu člověka. Tyto záznamy mají autora **„Systém"**.
- **Export dat** — každý export CSV se zaznamenává.

### Jak záznamy vypadají

Záznamy jsou seskupeny do **karet** — jedna karta odpovídá jedné akci. Karty jsou řazeny od nejnovějších a sdruženy pod hlavičky **Dnes / Včera / datum**.

Každá karta zobrazuje jedním řádkem stručný popis akce, například:

- *Schválení žádosti o dovolenou — Jan Novák*
- *Upravení zaměstnance — Eva Procházková*
- *Systém — Automatické ukončení pracovního poměru*

Kliknutím na kartu ji **rozbalíte** a zobrazíte podrobnosti: u úprav se zobrazují změněná pole ve tvaru *popisek: původní hodnota → nová hodnota*. U zaměstnanců jsou pole rozdělena podle oblastí (Osobní údaje / Kontakt / …). Záznamy o úpravách směn uvádějí **konkrétní datum každého změněného dne**.

> 📝 Citlivé hodnoty (rodné číslo, číslo OP, bankovní účet) se v logu nikdy nezobrazují — karta pouze uvede, že k odhalení nebo změně citlivého pole došlo.

### Filtrování

Nad seznamem karet je panel filtrů. Filtry lze libovolně kombinovat; tlačítkem **Vymazat filtry** je všechny najednou zrušíte.

#### Stránka

Kliknutím na jedno nebo více tlačítek zvolíte **část aplikace**, ve které ke změně došlo. Dostupné stránky:

**Směny** · **Dovolená** · **Zaměstnanci** · **Mzdy** · **Šablony smluv** · **Můj profil** · **Nastavení** · **Systém**

Po výběru stránky se automaticky zobrazí **doplňkové filtry** relevantní pro danou oblast. Příklady:

| Vybraná stránka | Doplňkové filtry, které se zobrazí |
|---|---|
| Zaměstnanci | Zaměstnanec (jméno), Oblast nastavení, Od / Do (rozsah dat) |
| Mzdy | Rok, Měsíc, Od / Do |
| Směny | Rok, Měsíc, Od / Do |
| Šablony smluv | Šablona |
| Nastavení | Oblast nastavení |
| Ostatní | Od / Do (rozsah dat) |

#### Autor změny

Kliknutím na jméno jednoho nebo více uživatelů ze seznamu zobrazíte pouze záznamy, které vytvořili ti konkrétní lidé. Automatické akce systému jsou označeny autorem **„Systém"** a lze je takto odfiltrovat samostatně.

#### Rozsah dat (Od / Do)

Pole **Od** a **Do** omezí zobrazené záznamy na zvolené časové období.
