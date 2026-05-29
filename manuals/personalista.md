# Příručka — Personalista

Tato příručka popisuje práci s aplikací HPM Intranet z pohledu **personalisty (HR)**. Spravujete evidenci zaměstnanců a jejich smluv, prohlížíte a vyplňujete směny a evidujete dovolenou.

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Přihlášení](#přihlášení)
- [Přehled (úvodní dashboard)](#přehled)
- [Zaměstnanci](#zaměstnanci)
- [Smlouvy a šablony](#smlouvy-a-šablony)
- [Směny](#směny)
- [Dovolená](#dovolená)
- [Můj profil](#můj-profil)

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

Úvodní stránka po přihlášení. Ukazuje aktuální provozní situaci pro dnešní den:

- kdo má dnes směnu (recepce i portýři), kdo je MOD (vedoucí směny),
- kteří vedoucí jsou nepřítomní,
- rychlé statistiky personálu (počty, věkové složení, národnosti, pozice).

> 📷 *(Místo pro snímek obrazovky: Přehled)*

---

## Zaměstnanci

Evidence všech zaměstnanců. Záložky **Aktivní** a **Ukončení** přepínají mezi zaměstnanci v pracovním poměru a ukončenými.

Spravujete celou evidenci zaměstnanců s jednou výjimkou: **nevidíte záznamy zaměstnanců, kteří jsou zároveň administrátor, ředitel nebo vedoucí** — tito se vám v seznamu nezobrazují.

### Vyhledávání a seznam

- Vyhledávací pole hledá podle jména, příjmení, **rodného příjmení**, pozice i národnosti.
- Řádky jsou barevně odlišené podle typu smlouvy (HPP / PPP / DPP).
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky.

> 📷 *(Místo pro snímek obrazovky: seznam zaměstnanců)*

### Nový zaměstnanec

Tlačítkem **+ Přidat zaměstnance** vyplníte osobní údaje, kontakt, doklady a benefity. Podle **národnosti** se zobrazí buď sekce *OP* (občané ČR), nebo *Pas + Povolení k pobytu* (cizinci).

- **Reaktivace ukončeného zaměstnance:** pokud zadáte jméno a datum narození, které odpovídá již existujícímu **ukončenému** zaměstnanci, aplikace nabídne *„Reaktivovat a upravit údaje"* (otevře profil existujícího zaměstnance k úpravě — pracovní poměr *Nástup* pak přidáte ručně v historii), *„Přesto vytvořit nového"*, nebo *Zrušit*. Tím se zabrání duplicitám.

### Detail zaměstnance

Detail má tři záložky — **Detail** (osobní a kontaktní údaje), **Historie pracovního poměru** a **Další dokumenty**.

- **Citlivé údaje** (rodné číslo, číslo OP, číslo pojištěnce, bankovní účet) jsou skryté; zobrazíte je kliknutím na ikonu oka. **Každé zobrazení se zaznamenává.**
- **Upravit** otevře editaci údajů.

> 📷 *(Místo pro snímek obrazovky: detail zaměstnance)*

#### Historie pracovního poměru

Pracovní poměr je členěn na **sezení (sessions)** — každé začíná **Nástupem**, může obsahovat **Dodatky** (změna mzdy, pozice, úvazku, délky smlouvy) a končí **Ukončením**.

- **+ Přidat změnu** (Nástup / Dodatek / Ukončení).
- Mzda a pozice v záhlaví poměru se mění až **k datu platnosti Dodatku**.
- **Automatický přesun do „Ukončení":** zaměstnanec se do záložky *Ukončení* přesune sám, jakmile **uplyne datum ukončení** (smlouva na dobu určitou nebo zadané ukončení). Den ukončení je ještě aktivní — přesun proběhne až následující den. Naopak **budoucí Nástup** zaměstnance aktivuje **až v den nástupu**.
- U každého řádku lze podle stavu **vygenerovat smlouvu**, zobrazit ji, nebo nahrát podepsanou kopii.
- **Ad hoc dokumenty** (Multisport, Hmotná odpovědnost, vlastní šablony) se přidávají tlačítkem **+ Adhoc dokument**: zadáte datum podpisu a tlačítkem **Přidat** vznikne řádek dokumentu (zatím bez PDF). Řádek ukazuje **datum podpisu**, ne datum vytvoření. PDF se vygeneruje až dodatečně tlačítkem **Generovat smlouvu**.

#### Další dokumenty

Záložka **Další dokumenty** slouží k nahrávání libovolných PDF souborů k zaměstnanci (skeny, přílohy), které nejsou generovanými smlouvami.

- Tlačítkem **Nahrát dokument** zadáte **název dokumentu** a vyberete **PDF soubor** (max. 15 MB).
- U každého dokumentu lze soubor **Zobrazit**, **Stáhnout** nebo **Smazat**.

> 📷 *(Místo pro snímek obrazovky: záložka Další dokumenty)*

---

## Smlouvy a šablony

### Smlouvy zaměstnance

Smlouvy se generují z **Historie pracovního poměru** (Nástup, Dodatek, Ukončení) nebo jako samostatné dokumenty (Hmotná odpovědnost, Multisport) u zaměstnanců, které spravujete.

- **Vygenerovat** smlouvu z řádku historie → vytvoří se PDF podle šablony.
- Vygenerovanou smlouvu lze **zobrazit** (otevře se v nové záložce) a **stáhnout** pod čitelným názvem.
- **Nahrát podepsanou** kopii, případně ji smazat a vrátit do stavu „nepodepsáno".
- Pokud po vygenerování změníte parametry řádku, nabídne se **Znovu vygenerovat smlouvu**.

> 📷 *(Místo pro snímek obrazovky: záložka Smlouvy)*

### Šablony smluv

Stránka **Šablony smluv** obsahuje editor ve stylu Wordu (TipTap): formátování textu, tabulky, obrázky, odrážky, zalomení stránky, vkládání **proměnných** (jméno, mzda, datum…) a podmíněné bloky (např. text jen pro cizince). Náhled odpovídá výsledné stránce A4.

- **+ Nová šablona** vytvoří vlastní samostatnou šablonu.
- Změny se ukládají tlačítkem *Uložit*.

> 📷 *(Místo pro snímek obrazovky: editor šablon)*

---

## Směny

Měsíční plán směn (recepce, portýři, vedoucí). Plány můžete **prohlížet a vyplňovat**.

### Životní cyklus plánu

Plán prochází stavy **Vytvořený → Otevřený → Uzavřený → Publikovaný** (jednosměrně). Přechody mezi stavy (otevření, uzavření, publikace) i nastavení termínů provádí **administrátor nebo ředitel** — vy plán neposouváte dál, ale můžete vyplňovat směny v otevřeném plánu.

> 📷 *(Místo pro snímek obrazovky: měsíční plán směn)*

### Vyplňování směn

- Do buňky se zapisuje **kód směny** — např. `DA`, `NS` (denní/noční + hotel), `R`, `X` (volno), `ZDA`/`ZN…`, `HO` (home office).
- Pod plánem je **legenda** s vysvětlením typů směn, kódů hotelů a pravidel přestávek.
- **Limity X (volna):** HPP 8/měsíc, PPP 13/měsíc, DPP neomezeně; maximálně **6 X v řadě**.
- **MOD (vedoucí směny):** u jména vedoucího se zobrazuje písmeno MOD a počty směn.

### Export

Tlačítko **Exportovat ▾** nabízí **PDF** (plán na jednu stránku A4). Tlačítkem **DNES** se vrátíte na aktuální měsíc.

---

## Dovolená

Žádosti o dovolenou. Podáváte **vlastní žádosti** a vidíte schválené dovolené kolegů; cizí žádosti neschvalujete (pracujete v režimu zaměstnance).

- **Nová žádost** — zadáte termín a důvod. V sekci **Moje žádosti** vidíte stav svých žádostí.
- Schválenou žádost lze **upravit** — změna čeká na schválení administrátorem (původní termín platí, dokud není úprava schválena).
- **Schválené dovolené (všichni zaměstnanci)** — přehled schválených dovolených kolegů (jen řadoví zaměstnanci, ne management).
- Pokud termín koliduje s již naplánovanou směnou, žádost je **zablokována** s upozorněním.

> 📷 *(Místo pro snímek obrazovky: Dovolená — moje žádosti)*

---

## Můj profil

Vlastní karta zaměstnance.

- Vidíte své osobní údaje, kontakt, doklady a **historii pracovního poměru** (stejný formát jako na detailu zaměstnance).
- **Navrhnout úpravu** — změny se odešlou ke schválení administrátorovi/řediteli. Citlivá pole se při úpravě zobrazí, abyste viděli, co měníte (zobrazení se loguje).

> 📷 *(Místo pro snímek obrazovky: Můj profil)*
