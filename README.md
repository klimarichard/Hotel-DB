# HPM Intranet — Uživatelská příručka

HPM Intranet je interní HR systém společností Special Tours Prague (STP) a Hotel Property Management (HPM). Slouží k vedení evidence zaměstnanců, generování smluv, plánování směn, evidenci dovolených a výpočtu mezd.

Tato příručka popisuje práci s aplikací z pohledu uživatele. **Vývojářská a implementační dokumentace** je v [DOCUMENTATION.md](DOCUMENTATION.md).

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Přihlášení](#přihlášení)
- [Role a oprávnění](#role-a-oprávnění)
- [Přehled (úvodní dashboard)](#přehled)
- [Zaměstnanci](#zaměstnanci)
- [Směny](#směny)
- [Dovolená](#dovolená)
- [Mzdy](#mzdy)
- [Smlouvy a šablony](#smlouvy-a-šablony)
- [Upozornění](#upozornění)
- [Můj profil](#můj-profil)
- [Log změn](#log-změn)
- [Nastavení](#nastavení)

---

## Přihlášení

Aplikace je dostupná v prohlížeči. Přihlašujete se **uživatelským jménem a heslem**.

- Stačí zadat samotné uživatelské jméno (např. `vondra`) — doména `@hotel.local` se doplní automaticky. Funguje i zadání celého e-mailu.
- **Zapomenuté heslo:** na přihlašovací obrazovce klikněte na *„Zapomenuté heslo?"* a na váš e-mail přijde odkaz pro nastavení nového hesla.
- Administrátor vám může poslat odkaz pro reset hesla, případně vytvořit účet bez hesla — pak si při prvním přihlášení heslo zvolíte sami.

> 📷 *(Místo pro snímek obrazovky: přihlašovací formulář)*

Vlevo dole je vždy vidět **jméno přihlášeného uživatele**; tlačítkem *Odhlásit* se odhlásíte. Vedle je přepínač **světlého/tmavého režimu**.

---

## Role a oprávnění

Systém má šest rolí. Každá vidí jen ty části aplikace, na které má právo — položky v menu i samotné stránky jsou podle role skryté.

| Role | Stručně | Hlavní přístup |
|---|---|---|
| **Administrátor** | plný přístup vč. nastavení | vše, včetně *Nastavení* |
| **Ředitel** | jako administrátor, kromě nastavení | vše kromě *Nastavení* |
| **Vedoucí** (manager) | plánování a vyplňování směn | Přehled, Směny, Dovolená, Můj profil |
| **Zaměstnanec** | vlastní směny, dovolená, profil | Přehled, Směny, Dovolená, Můj profil |
| **Účetní** | náhled na data, bez úprav | Přehled (statistiky), Zaměstnanci (jen čtení + export) |
| **Personalista** (HR) | správa zaměstnanců a smluv | Zaměstnanci, Smlouvy, Směny, Dovolená, Přehled, Můj profil |

Důležité poznámky k oprávněním:

- **Mzdy, Smlouvy, Upozornění a Log změn** vidí pouze **administrátor a ředitel**.
- **Nastavení** je dostupné **pouze administrátorovi**.
- **Účetní** má vše jen pro čtení — může odhalit citlivé údaje, stáhnout smlouvu a exportovat data, ale nic needituje; nemá *Můj profil* ani směny.
- **Personalista** spravuje zaměstnance a smlouvy s jednou výjimkou: **nevidí záznamy zaměstnanců, kteří jsou zároveň administrátor/ředitel/vedoucí**.
- **Vedoucí** vidí směnové plány ve všech stavech a může je vyplňovat, ale **nemůže plán otevřít/uzavřít/publikovat** — to dělá administrátor nebo ředitel.

V dalších kapitolách jsou u jednotlivých akcí uvedeny poznámky *(kdo smí)*.

---

## Přehled

Úvodní stránka po přihlášení. Ukazuje aktuální provozní situaci pro dnešní den:

- kdo má dnes směnu (recepce i portýři), kdo je MOD (vedoucí směny),
- kteří vedoucí jsou nepřítomní,
- rychlé statistiky personálu (počty, věkové složení, národnosti, pozice).

> 📷 *(Místo pro snímek obrazovky: Přehled)*

*Kdo to vidí:* všichni přihlášení. **Účetní** vidí pouze statistickou část (bez směnových informací).

---

## Zaměstnanci

Evidence všech zaměstnanců. Záložky **Aktivní** a **Ukončení** přepínají mezi zaměstnanci v pracovním poměru a ukončenými.

*Kdo to vidí:* administrátor, ředitel, personalista, účetní (účetní jen pro čtení).

### Vyhledávání a seznam

- Vyhledávací pole hledá podle jména, příjmení, **rodného příjmení**, pozice i národnosti.
- Řádky jsou barevně odlišené podle typu smlouvy (HPP / PPP / DPP).
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky *(administrátor, ředitel, účetní)*.

> 📷 *(Místo pro snímek obrazovky: seznam zaměstnanců)*

### Nový zaměstnanec

Tlačítko **+ Přidat zaměstnance** *(administrátor, ředitel, personalista)*. Vyplníte osobní údaje, kontakt, doklady a benefity. Podle **národnosti** se zobrazí buď sekce *OP* (občané ČR), nebo *Pas + Povolení k pobytu* (cizinci).

- **Reaktivace ukončeného zaměstnance:** pokud zadáte jméno a datum narození, které odpovídá již existujícímu **ukončenému** zaměstnanci, aplikace nabídne *„Reaktivovat a upravit údaje"* (otevře profil existujícího zaměstnance k úpravě — pracovní poměr *Nástup* pak přidáte ručně v historii), *„Přesto vytvořit nového"*, nebo *Zrušit*. Tím se zabrání duplicitám.

### Detail zaměstnance

Detail má dvě hlavní části — **Detail** (osobní a kontaktní údaje) a **Historie pracovního poměru**.

- **Citlivé údaje** (rodné číslo, číslo OP, číslo pojištěnce, bankovní účet) jsou skryté; zobrazíte je kliknutím na ikonu oka. **Každé zobrazení se zaznamenává do Logu změn.**
- **Upravit** otevře editaci údajů *(administrátor, ředitel, personalista)*.

> 📷 *(Místo pro snímek obrazovky: detail zaměstnance)*

#### Historie pracovního poměru

Pracovní poměr je členěn na **sezení (sessions)** — každé začíná **Nástupem**, může obsahovat **Dodatky** (změna mzdy, pozice, úvazku, délky smlouvy) a končí **Ukončením**.

- **+ Přidat změnu** (Nástup / Dodatek / Ukončení) — *(administrátor, ředitel, personalista)*.
- Mzda a pozice v záhlaví poměru se mění až **k datu platnosti Dodatku**.
- **Automatický přesun do „Ukončení":** zaměstnanec se do záložky *Ukončení* přesune sám, jakmile **uplyne datum ukončení** (smlouva na dobu určitou nebo zadané ukončení). Den ukončení je ještě aktivní — přesun proběhne až následující den. Naopak **budoucí Nástup** zaměstnance aktivuje **až v den nástupu**.
- U každého řádku lze podle stavu **vygenerovat smlouvu**, zobrazit ji, nebo nahrát podepsanou kopii.

---

## Směny

Měsíční plán směn (recepce, portýři, vedoucí).

*Kdo to vidí:* administrátor, ředitel, vedoucí, zaměstnanec, personalista.

### Životní cyklus plánu

Plán prochází stavy **Vytvořený → Otevřený → Uzavřený → Publikovaný** (jednosměrně). Přechody mohou být automatické podle nastavených termínů, nebo je spouští administrátor/ředitel.

- **Vytvoření plánu, přechody mezi stavy, nastavení termínů a kopírování zaměstnanců z předchozího plánu** — *pouze administrátor a ředitel*.
- Plán ve stavu *Vytvořený* zaměstnanci nevidí; objeví se až po otevření.
- **Vedoucí** vidí všechny stavy a může vyplňovat směny v otevřeném plánu, ale plán neposouvá dál.

> 📷 *(Místo pro snímek obrazovky: měsíční plán směn)*

### Vyplňování směn

- Do buňky se zapisuje **kód směny** — např. `DA`, `NS` (denní/noční + hotel), `R`, `X` (volno), `ZDA`/`ZN…`, `HO` (home office).
- Pod plánem je **legenda** s vysvětlením typů směn, kódů hotelů a pravidel přestávek.
- **Limity X (volna):** HPP 8/měsíc, PPP 13/měsíc, DPP neomezeně; maximálně **6 X v řadě**. Administrátor a ředitel limitům nepodléhají a mohou je navýšit.
- **MOD (vedoucí směny):** u jména vedoucího se zobrazuje písmeno MOD a počty směn; písmeno lze upravit kliknutím *(administrátor, ředitel)*.

### Žádosti o změnu směny

V **publikovaném** plánu může zaměstnanec dvojklikem na buňku podat **žádost o změnu** směny. Schválení žádosti směnu automaticky nemění — úpravu provede administrátor ručně. Počet čekajících žádostí ukazuje odznak u položky *Směny* v menu.

### Export

Tlačítko **Exportovat ▾** nabízí **PDF** (plán na jednu stránku A4) a **CSV** *(administrátor, ředitel)*. Tlačítkem **DNES** se vrátíte na aktuální měsíc.

---

## Dovolená

Žádosti o dovolenou a jejich schvalování.

*Kdo to vidí:* administrátor, ředitel, vedoucí, zaměstnanec, personalista.

### Pro zaměstnance

- **Nová žádost** — zadáte termín a důvod. V sekci **Moje žádosti** vidíte stav svých žádostí.
- Schválenou žádost lze **upravit** — změna čeká na schválení administrátorem (původní termín platí, dokud není úprava schválena).
- **Schválené dovolené (všichni zaměstnanci)** — přehled schválených dovolených kolegů (jen řadoví zaměstnanci, ne management).
- Pokud termín koliduje s již naplánovanou směnou, žádost je **zablokována** s upozorněním.

> 📷 *(Místo pro snímek obrazovky: Dovolená — moje žádosti)*

### Pro administrátora / ředitele

- **Všechny žádosti** — aktuální a budoucí žádosti k vyřízení; starší vyřízené jsou ve sbalené sekci **Starší žádosti**.
- Žádost lze **schválit** nebo **zamítnout**. Schválená dovolená se automaticky promítne jako *X* do překrývajících se směnových plánů.
- Při kolizi se schválenými směnami se otevře dialog, kde vyberete, které dny vyjmout.

---

## Mzdy

Měsíční mzdové podklady. *Kdo to vidí: pouze administrátor a ředitel.*

> 📷 *(Místo pro snímek obrazovky: mzdy za měsíc)*

### Základní práce

- Mzdy se počítají z publikovaného směnového plánu. Pokud období ještě neexistuje, vytvoříte ho tlačítkem **Vytvořit mzdy ručně**.
- Tlačítko **Přepočítat** znovu načte odpracované hodiny z plánu (zachová ruční úpravy, Nemoc i poznámky).
- Zaměstnanci jsou seřazeni podle příjmení (české řazení). Sekce: **Vedoucí** zvlášť, **Recepce a portýři** dohromady.

### Sloupce a úpravy

- **Hodiny, Výkaz, Dovolená, Nemoc, Noční, Svátek, So+Ne, Navíc, Stravenky** a u DPP **DPP/faktura**.
- **Výkaz / Dovolená / Nemoc / Základ** se zadávají v dialogu (ikona ✎ u Dovolené): zadáte Nemoc (a případně ručně Výkaz nebo Základ), Dovolená se dopočítá.
- Ostatní číselné sloupce upravíte **dvojklikem** v buňce; ručně upravená buňka je označená a lze ji vrátit zpět ikonou ↺.
- **DPP/faktura** se počítá jako *odpracované hodiny × hodinová sazba pracovní pozice* zaměstnance (sazba se nastavuje v *Nastavení → Pracovní pozice*).

### Poznámky, zamčení, export

- Ke každému řádku lze přidat **poznámku**; ve výchozím stavu se přenáší do dalších měsíců, dokud ji někdo neoznačí jako přečtenou. Lze ji nastavit i jen pro daný měsíc.
- **Uzamčení období** (administrátor) zabrání dalším úpravám i přepočtu. Uzamčené období nelze smazat ani přepočítat.
- **Export PDF** vytvoří mzdový list za měsíc.
- Pro administrátora jsou navíc k dispozici **Tvrdý přepočet** (zahodí ruční úpravy a počítá čistě z plánu), **Smazat období** a přepočet jednotlivých složek u konkrétního zaměstnance (ikona ↻).

---

## Smlouvy a šablony

### Smlouvy zaměstnance

Smlouvy se generují z **Historie pracovního poměru** (Nástup, Dodatek, Ukončení) nebo jako samostatné dokumenty (Hmotná odpovědnost, Multisport). *Kdo to vidí: administrátor a ředitel; personalista u zaměstnanců, které spravuje.*

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

## Upozornění

Centrální přehled upozornění. *Kdo to vidí: pouze administrátor a ředitel.* Odznak u položky v menu ukazuje počet nepřečtených.

Záložky:
- **Doklady** — blížící se expirace OP / pasů / povolení k pobytu.
- **Zkušební doba** — blížící se konce zkušebních dob.
- **Dovolená** — žádosti čekající na vyřízení.
- **Výjimky** — čekající výjimky ze směnových pravidel.
- **Žádosti o změny** — návrhy úprav údajů z *Můj profil*.

> 📷 *(Místo pro snímek obrazovky: Upozornění)*

Přečtené položky lze odbavit; stav přečtení je společný pro všechny administrátory.

---

## Můj profil

Vlastní karta zaměstnance. *Kdo to vidí: administrátor, ředitel, vedoucí, zaměstnanec, personalista (nikoli účetní).*

- Vidíte své osobní údaje, kontakt, doklady a **historii pracovního poměru** (stejný formát jako na detailu zaměstnance).
- **Navrhnout úpravu** — změny se odešlou ke schválení administrátorovi/řediteli (objeví se v *Upozornění → Žádosti o změny*). Citlivá pole se při úpravě zobrazí, abyste viděli, co měníte (zobrazení se loguje).

> 📷 *(Místo pro snímek obrazovky: Můj profil)*

---

## Log změn

Historie všech změn v systému (kdo, co a kdy změnil). *Kdo to vidí: pouze administrátor a ředitel.*

- Změny jsou seskupené do **karet podle jedné akce** (jedno uložení = jedna karta), řazené pod hlavičky **Dnes / Včera / datum**.
- Každá karta je ve výchozím stavu **sbalená na jeden řádek**; rozkliknutím zobrazíte změněná pole ve tvaru *popisek: původní → nová hodnota*, u zaměstnanců rozdělená podle oblastí (Osobní údaje / Kontakt / …).
- Filtrovat lze podle **zaměstnance, autora, oblasti, akce a data**.
- Citlivé údaje se v logu nikdy nezobrazují (pouze informace, že se pole změnilo).
- Tlačítkem **Technický detail** lze u karty zobrazit surová data.

Historie změn konkrétního zaměstnance je i přímo na jeho detailu v sekci **Historie změn**.

> 📷 *(Místo pro snímek obrazovky: Log změn)*

---

## Nastavení

*Kdo to vidí: pouze administrátor.* Stránka je členěná do záložek:

- **Společnosti** — přidání, úprava a odebrání společností (název, zkratka, IČO, DIČ…).
- **Pracovní pozice** — katalog pozic včetně **hodinové sazby**, výchozí mzdy a příspěvků. Změna hodinové sazby se může promítnout do aktivních pracovních poměrů (s potvrzením).
- **Oddělení** — katalog oddělení.
- **Vzdělání** — stupně vzdělání pro výběr u zaměstnance.
- **Mzdy** — sazba stravenky, maximální měsíční odměna DPP a **minimální mzda**.
- **Menu** — pořadí položek v levém menu pro jednotlivé role.
- **Uživatelé** — vytváření a správa uživatelských účtů: vytvoření (i bez hesla s odkazem pro reset), úprava jména/e-mailu/role, deaktivace a reaktivace, reset hesla, propojení účtu se zaměstnancem. Neaktivní účty jsou dole; při vytvoření účtu se stejným e-mailem jako neaktivní účet se nabídne jeho reaktivace.

> 📷 *(Místo pro snímek obrazovky: Nastavení)*

---

*Pro implementační a technické detaily viz [DOCUMENTATION.md](DOCUMENTATION.md).*
