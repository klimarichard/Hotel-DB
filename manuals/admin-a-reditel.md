# Příručka — Administrátor a ředitel

Tato příručka popisuje práci s aplikací HPM Intranet z pohledu **administrátora** a **ředitele**. Obě role mají téměř shodný přístup ke všem částem systému; **jediný rozdíl je, že stránka *Nastavení* je dostupná pouze administrátorovi** — ředitel ji nevidí.

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Přihlášení](#přihlášení)
- [Přehled](#přehled)
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
- Jako administrátor můžete ostatním uživatelům poslat odkaz pro reset hesla, případně vytvořit účet bez hesla — uživatel si pak při prvním přihlášení heslo zvolí sám.

> 📷 *(Místo pro snímek obrazovky: přihlašovací formulář)*

Vlevo dole je vždy vidět **jméno přihlášeného uživatele**; tlačítkem *Odhlásit* se odhlásíte. Vedle je přepínač **světlého/tmavého režimu**.

---

## Přehled

Úvodní stránka po přihlášení. Ukazuje aktuální provozní situaci pro dnešní den:

- kdo má dnes směnu (recepce i portýři), kdo je MOD (vedoucí směny),
- kteří FOM jsou nepřítomní,
- rychlé statistiky personálu (počty, věkové složení, národnosti, pozice).

> 📷 *(Místo pro snímek obrazovky: Přehled)*

---

## Zaměstnanci

Evidence všech zaměstnanců. Záložky **Aktivní** a **Ukončení** přepínají mezi zaměstnanci v pracovním poměru a ukončenými.

### Vyhledávání a seznam

- Vyhledávací pole hledá podle jména, příjmení, **rodného příjmení**, pozice i národnosti.
- Řádky jsou barevně odlišené podle typu smlouvy (HPP / PPP / DPP).
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky.

> 📷 *(Místo pro snímek obrazovky: seznam zaměstnanců)*

### Nový zaměstnanec

Tlačítko **+ Přidat zaměstnance**. Vyplníte osobní údaje, kontakt, doklady a benefity. Podle **národnosti** se zobrazí buď sekce *OP* (občané ČR), nebo *Pas + Povolení k pobytu* (cizinci).

- **Reaktivace ukončeného zaměstnance:** pokud zadáte jméno a datum narození, které odpovídá již existujícímu **ukončenému** zaměstnanci, aplikace nabídne *„Reaktivovat a upravit údaje"* (otevře profil existujícího zaměstnance k úpravě — pracovní poměr *Nástup* pak přidáte ručně v historii), *„Přesto vytvořit nového"*, nebo *Zrušit*. Tím se zabrání duplicitám.

### Detail zaměstnance

Detail má tři záložky — **Detail** (osobní a kontaktní údaje), **Historie pracovního poměru** a **Další dokumenty**.

- **Citlivé údaje** (rodné číslo, číslo OP, číslo pojištěnce, bankovní účet) jsou skryté; zobrazíte je kliknutím na ikonu oka. **Každé zobrazení se zaznamenává do Logu změn.**
- **Upravit** otevře editaci údajů.

> 📷 *(Místo pro snímek obrazovky: detail zaměstnance)*

##### Benefity — Multisport

Multisport se spravuje přímo na detailu zaměstnance v sekci **Benefity** tlačítkem **„Spravovat"** (dřívější zaškrtávátko Multisport se dvěma daty ve formuláři zaměstnance už není — správa se přesunula sem).

- Lze zadat **více období Multisport** (datum *od* / *do*; pole *do* můžete nechat prázdné = členství trvá).
- Lze přidat i **doprovodné Multisport karty** (parametry: **jméno, od, do, cena**), klidně více najednou.

#### Historie pracovního poměru

Pracovní poměr je členěn na **sezení (sessions)** — každé začíná **Nástupem**, může obsahovat **Dodatky** (změna mzdy, pozice, úvazku, délky smlouvy) a končí **Ukončením**.

- **+ Přidat změnu** (Nástup / Dodatek / Ukončení).
- Mzda a pozice v záhlaví poměru se mění až **k datu platnosti Dodatku**.
- **Automatický přesun do „Ukončení":** zaměstnanec se do záložky *Ukončení* přesune sám, jakmile **uplyne datum ukončení** (smlouva na dobu určitou nebo zadané ukončení). Den ukončení je ještě aktivní — přesun proběhne až následující den. Naopak **budoucí Nástup** zaměstnance aktivuje **až v den nástupu**.
- **Ukončení a Multisport:** má-li ukončovaný zaměstnanec aktivní Multisport, aplikace automaticky nastaví konec Multisportu na **konec měsíce ukončení** a upozorní, že je potřeba Multisport zrušit i v **extranetu Multisport**.
- U každého řádku lze podle stavu **vygenerovat smlouvu**, zobrazit ji, nebo nahrát podepsanou kopii.
- **Ad hoc dokumenty** (Multisport, Hmotná odpovědnost, vlastní šablony) se přidávají tlačítkem **+ Adhoc dokument**: zadáte datum podpisu a tlačítkem **Přidat** vznikne řádek dokumentu (zatím bez PDF). Řádek pak ukazuje **datum podpisu**, ne datum vytvoření. PDF se vygeneruje až dodatečně tlačítkem **Generovat smlouvu** — stejný postup jako u záznamů pracovního poměru.

#### Další dokumenty

Záložka **Další dokumenty** slouží k nahrávání libovolných PDF souborů k zaměstnanci (skeny, přílohy), které nejsou generovanými smlouvami.

- Tlačítkem **Nahrát dokument** zadáte **název dokumentu** a vyberete **PDF soubor** (max. 15 MB).
- U každého dokumentu lze soubor **Zobrazit**, **Stáhnout** nebo **Smazat**.
- Nahrávat a mazat mohou administrátor, ředitel a personalista; FOM a účetní dokumenty pouze prohlížejí.

> 📷 *(Místo pro snímek obrazovky: záložka Další dokumenty)*

### Export CSV

Tlačítkem **Exportovat CSV** v seznamu zaměstnanců otevřete dialog, ve kterém vyberete sloupce a filtry a stáhnete data do tabulky. Export může zahrnovat i citlivé údaje; každý takový export se zaznamenává do Logu změn.

---

## Směny

Měsíční plán směn (recepce, portýři, FOM).

### Životní cyklus plánu

Plán prochází stavy **Vytvořený → Otevřený → Uzavřený → Publikovaný** (jednosměrně). Přechody mohou být automatické podle nastavených termínů, nebo je spouštíte ručně.

- **Vytvoření plánu, přechody mezi stavy, nastavení termínů a kopírování zaměstnanců z předchozího plánu** děláte vy (administrátor i ředitel).
- Plán ve stavu *Vytvořený* zaměstnanci nevidí; objeví se až po otevření.
- FOM vidí všechny stavy a může vyplňovat směny v otevřeném plánu, ale plán neposouvá dál — to děláte vy.

> 📷 *(Místo pro snímek obrazovky: měsíční plán směn)*

### Vyplňování směn

- Do buňky se zapisuje **kód směny** — např. `DA`, `NS` (denní/noční + hotel), `R`, `X` (volno), `ZDA`/`ZN…`, `HO` (home office).
- Pod plánem je **legenda** s vysvětlením typů směn, kódů hotelů a pravidel přestávek.
- **Limity X (volna):** HPP 8/měsíc, PPP 13/měsíc, DPP neomezeně; maximálně **6 X v řadě**. Vy (administrátor a ředitel) limitům nepodléháte. Dny dovolené se do limitu **nezapočítávají**.
- **Navýšení limitu X:** u jména zaměstnance je odznak `X: využito / limit`. Pokud má zaměstnanec v daném měsíci schválenou **dovolenou**, zobrazí se i počet dní dovolené (`… dovolená`) a ikonka `✎`, kterou nastavíte **nový limit X pro tento měsíc** (kolik X smí napsat nad rámec dovolené). Bez schválené dovolené limit upravit nelze. Odznak X se zobrazuje jen ve stavech *Vytvořený* a *Otevřený*.
- **MOD (vedoucí směny):** u jména FOM se zobrazuje písmeno MOD; písmeno upravíte kliknutím. Počty směn u MOD (`MOD: N …`) se zobrazují jen ve stavech *Uzavřený* a *Publikovaný*.
- **Tabulka obsazenosti:** přehled počtu obsazených směn po dnech vidíte (jako administrátor) ve **všech stavech** plánu, nejen v uzavřeném.

### Volné směny

V **publikovaném** plánu se dole zobrazují **volné (neobsazené) směny** portýrů (`DPQ`, `NPQ`, `NPA` každý den; `DPA` jen ve dnech, které označíte). Den ve volné směně **DPA** zapnete/vypnete **kliknutím na buňku** v řádku DPA.

- Volný den má barevný štítek směny, obsazený den `✓`.
- Zaměstnanec si volnou směnu vyžádá **dvojklikem**. Po vašem **schválení** se směna automaticky zapíše danému zaměstnanci a konkurenční žádosti o stejnou směnu se zamítnou.

### Mazání plánu

Plán lze **smazat pouze ve stavu *Vytvořený***. Jakmile je otevřený nebo dál, tlačítko pro smazání zmizí (a smazání je zablokované i na pozadí), aby nedošlo ke ztrátě již vyplněných směn.

### Žádosti o změnu směny

V **publikovaném** plánu může zaměstnanec dvojklikem na buňku podat **žádost o změnu** směny. Schválení žádosti směnu automaticky nemění — úpravu provedete ručně. Počet čekajících žádostí ukazuje odznak u položky *Směny* v menu.

### Export

Tlačítko **Exportovat ▾** nabízí **PDF** (plán na jednu stránku A4) a **CSV**. Tlačítkem **DNES** se vrátíte na aktuální měsíc.

---

## Dovolená

Žádosti o dovolenou a jejich schvalování.

### Schvalování a vyřizování

- **Všechny žádosti** — aktuální a budoucí žádosti k vyřízení; starší vyřízené jsou ve sbalené sekci **Starší žádosti**.
- Žádost lze **schválit** nebo **zamítnout**. Schválená dovolená se automaticky promítne jako *X* do překrývajících se směnových plánů.
- Při kolizi se schválenými směnami se otevře dialog, kde vyberete, které dny vyjmout.
- Schválenou žádost lze také **upravit** — pokud úpravu podá zaměstnanec, čeká na vaše schválení (původní termín platí, dokud není úprava schválena).

> 📷 *(Místo pro snímek obrazovky: Dovolená — všechny žádosti)*

### Vlastní žádosti a přehled

- **Nová žádost** — zadáte termín a důvod; v sekci **Moje žádosti** vidíte stav svých žádostí.
- **Schválené dovolené (všichni zaměstnanci)** — přehled schválených dovolených (jen řadoví zaměstnanci, ne management).
- Pokud termín koliduje s již naplánovanou směnou, žádost je **zablokována** s upozorněním.

---

## Mzdy

Měsíční mzdové podklady.

> 📷 *(Místo pro snímek obrazovky: mzdy za měsíc)*

### Základní práce

- Mzdy se počítají z publikovaného směnového plánu. Pokud období ještě neexistuje, vytvoříte ho tlačítkem **Vytvořit mzdy ručně**.
- Tlačítko **Přepočítat** znovu načte odpracované hodiny z plánu (zachová ruční úpravy, Nemoc i poznámky).
- Zaměstnanci jsou seřazeni podle příjmení (české řazení). Sekce: **FOM** zvlášť, **Recepce a portýři** dohromady.

### Sloupce a úpravy

- **Hodiny, Výkaz, Dovolená, Nemoc, Noční, Svátek, So+Ne, Navíc, Stravenky** a u DPP **DPP/faktura**.
- **Výkaz / Dovolená / Nemoc / Základ** se zadávají v dialogu (ikona ✎ u Dovolené): zadáte Nemoc (a případně ručně Výkaz nebo Základ), Dovolená se dopočítá.
- Ostatní číselné sloupce upravíte **dvojklikem** v buňce; ručně upravená buňka je označená a lze ji vrátit zpět ikonou ↺.
- **DPP/faktura** se počítá jako *odpracované hodiny × hodinová sazba pracovní pozice* zaměstnance (sazba se nastavuje v *Nastavení → Pracovní pozice*).
- **Multisport** ukazuje **cenu**, kterou má zaměstnanec za daný měsíc zaplatit (= základní cena Multisport + ceny všech aktivních doprovodných karet za daný měsíc), místo dřívějšího „ANO".

### Poznámky, zamčení, export

- Ke každému řádku lze přidat **poznámku**; ve výchozím stavu se přenáší do dalších měsíců, dokud ji někdo neoznačí jako přečtenou. Lze ji nastavit i jen pro daný měsíc.
- **Uzamčení období** (administrátor) zabrání dalším úpravám i přepočtu. Uzamčené období nelze smazat ani přepočítat.
- **Export PDF** vytvoří mzdový list za měsíc.
- Pro administrátora jsou navíc k dispozici **Tvrdý přepočet** (zahodí ruční úpravy a počítá čistě z plánu), **Smazat období** a přepočet jednotlivých složek u konkrétního zaměstnance (ikona ↻).

---

## Smlouvy a šablony

### Smlouvy zaměstnance

Smlouvy se generují z **Historie pracovního poměru** (Nástup, Dodatek, Ukončení) nebo jako samostatné dokumenty (Hmotná odpovědnost, Multisport).

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

Centrální přehled upozornění. Odznak u položky v menu ukazuje počet nepřečtených.

Záložky:
- **Doklady** — blížící se expirace OP / pasů / povolení k pobytu.
- **Zkušební doba** — blížící se konce zkušebních dob.
- **Dovolená** — žádosti čekající na vyřízení.
- **Výjimky** — čekající výjimky ze směnových pravidel.
- **Žádosti o změny** — návrhy úprav údajů z *Můj profil*.

> 📷 *(Místo pro snímek obrazovky: Upozornění)*

Přečtené položky lze odbavit; stav přečtení je společný pro všechny administrátory a ředitele.

---

## Můj profil

Vlastní karta zaměstnance.

- Vidíte své osobní údaje, kontakt, doklady a **historii pracovního poměru** (stejný formát jako na detailu zaměstnance).
- **Navrhnout úpravu** — změny se odešlou ke schválení (objeví se v *Upozornění → Žádosti o změny*). Citlivá pole se při úpravě zobrazí, abyste viděli, co měníte (zobrazení se loguje).

> 📷 *(Místo pro snímek obrazovky: Můj profil)*

---

## Log změn

Historie všech změn v systému (kdo, co a kdy změnil).

- Změny jsou seskupené do **karet podle jedné akce** (jedno uložení = jedna karta), řazené pod hlavičky **Dnes / Včera / datum**.
- Každá karta je ve výchozím stavu **sbalená na jeden řádek**; rozkliknutím zobrazíte změněná pole ve tvaru *popisek: původní → nová hodnota*, u zaměstnanců rozdělená podle oblastí (Osobní údaje / Kontakt / …).
- Filtrovat lze podle **zaměstnance, autora, oblasti, akce a data**.
- Citlivé údaje se v logu nikdy nezobrazují (pouze informace, že se pole změnilo).
- Tlačítkem **Technický detail** lze u karty zobrazit surová data.

Historie změn konkrétního zaměstnance je i přímo na jeho detailu v sekci **Historie změn**.

> 📷 *(Místo pro snímek obrazovky: Log změn)*

---

## Nastavení

**Tato stránka je dostupná pouze administrátorovi — ředitel ji nevidí.** Stránka je členěná do záložek:

- **Společnosti** — přidání, úprava a odebrání společností (název, zkratka, IČO, DIČ…).
- **Pracovní pozice** — katalog pozic včetně **hodinové sazby**, výchozí mzdy a příspěvků. Změna hodinové sazby se může promítnout do aktivních pracovních poměrů (s potvrzením).
- **Oddělení** — katalog oddělení.
- **Vzdělání** — stupně vzdělání pro výběr u zaměstnance.
- **Mzdy** — sazba stravenky, maximální měsíční odměna DPP, **minimální mzda** a **základní cena Multisport** (výchozí 470 Kč/měsíc).
- **Menu** — pořadí položek v levém menu pro jednotlivé role.
- **Uživatelé** — vytváření a správa uživatelských účtů: vytvoření (i bez hesla s odkazem pro reset), úprava jména/e-mailu/role, deaktivace a reaktivace, reset hesla, propojení účtu se zaměstnancem. Neaktivní účty jsou dole; při vytvoření účtu se stejným e-mailem jako neaktivní účet se nabídne jeho reaktivace.

> 📷 *(Místo pro snímek obrazovky: Nastavení)*
