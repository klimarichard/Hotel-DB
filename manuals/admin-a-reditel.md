# Příručka — Administrátor a ředitel

Tato příručka popisuje práci s aplikací HPM Intranet z pohledu **administrátora** a **ředitele**. Obě role mají téměř shodný přístup ke všem částem systému; **jediný rozdíl je, že stránka *Nastavení* je dostupná pouze administrátorovi** — ředitel ji nevidí.

> 📷 *(Místo pro snímek obrazovky: úvodní obrazovka aplikace)*

---

## Obsah

- [Průvodce a Nápověda](#průvodce-a-nápověda)
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

## Průvodce a Nápověda

Při **prvním přihlášení** se automaticky spustí interaktivní **Prohlídka aplikace** — průvodce, který vás krok po kroku provede těmi částmi aplikace, ke kterým máte přístup. Průvodce je přizpůsobený právě vašim oprávněním a jako administrátor/ředitel uvidíte kroky pro všechny oblasti systému.

- Průvodce můžete kdykoli přerušit tlačítkem **Přeskočit**.
- V záhlaví každého vyskakovacího okénka průvodce je vedle čítače kroků (např. „Zaměstnanci · Krok 2 z 5") zobrazen název aktuální sekce. Pomocí tlačítek **„‹ Předchozí sekce"** a **„Další sekce ›"** můžete přeskočit celou sekci najednou — jako administrátor/ředitel s přístupem do všech oblastí systému to výrazně urychlí orientaci.
- Pokud se po přihlášení do aplikace přidají nové funkce, průvodce vás krátce uvítá oznámením **„Co je nového"** a ukáže jen kroky týkající se těchto novinek — celou prohlídku znovu absolvovat nemusíte.
- Chcete-li si celou prohlídku zopakovat, klikněte vlevo dole na tlačítko **„? Nápověda"**. Otevře se stránka **Nápověda**, kde najdete tlačítko pro opětovné spuštění průvodce a přehled sekcí aplikace, ve kterém lze vyhledávat.

> 📷 *(Místo pro snímek obrazovky: tlačítko Nápověda v levém dolním rohu)*

---

## Přihlášení

Aplikace je dostupná v prohlížeči. Přihlašujete se **uživatelským jménem a heslem**.

- Stačí zadat samotné uživatelské jméno (např. `vondra`) — doména `@hotel.local` se doplní automaticky. Funguje i zadání celého e-mailu.
- **Zapomenuté heslo:** na přihlašovací obrazovce klikněte na *„Zapomenuté heslo?"* a na váš e-mail přijde odkaz pro nastavení nového hesla.
- Jako administrátor můžete ostatním uživatelům poslat odkaz pro reset hesla, případně vytvořit účet bez hesla — uživatel si pak při prvním přihlášení heslo zvolí sám.

> 📷 *(Místo pro snímek obrazovky: přihlašovací formulář)*

Vlevo dole je vždy vidět **jméno přihlášeného uživatele**. Pod ním jsou tři tlačítka v pořadí: přepínač **světlého/tmavého režimu** → **? Nápověda** → **Odhlásit**.

---

## Přehled

Úvodní stránka po přihlášení. Ukazuje aktuální provozní situaci pro dnešní den:

- kdo má dnes směnu (recepce i portýři), kdo je MOD (vedoucí směny),
- kteří FOM jsou nepřítomní,
- rychlé statistiky personálu (počty, věkové složení, národnosti, pozice).

> 📷 *(Místo pro snímek obrazovky: Přehled)*

---

## Zaměstnanci

Evidence všech zaměstnanců. Záložky **Aktivní**, **Před nástupem** a **Ukončení** přepínají mezi zaměstnanci v pracovním poměru, nadcházejícími a ukončenými.

- Záložka **Před nástupem** zobrazuje zaměstnance, jejichž datum nástupu teprve nastane — tedy ty, kteří do práce ještě nenastoupili. Patří sem nové nábory i vracející se zaměstnanci s budoucím nástupem. V den nástupu se zaměstnanec automaticky přesune do záložky **Aktivní** — bez nutnosti jakékoli ruční akce.

### Vyhledávání a seznam

- Vyhledávací pole hledá podle jména, příjmení, **rodného příjmení**, pozice i národnosti. Při vyhledávání se prohledávají **všechny tři záložky najednou** (Aktivní, Před nástupem i Ukončení) — výsledky se zobrazí bez ohledu na to, kterou záložku máte vybranou. Prázdné hledání ukazuje jen aktuální záložku.
- Vedle jména je **odznak typu smlouvy** (HPP / PPP / DPP) — stejný jako ve mzdách. Řádky jsou navíc barevně odlišené podle typu smlouvy.
- Tlačítko **Exportovat CSV** otevře dialog, kde vyberete sloupce a filtry a stáhnete data do tabulky.

> 📷 *(Místo pro snímek obrazovky: seznam zaměstnanců)*

### Nový zaměstnanec

Tlačítko **+ Přidat zaměstnance**. Vyplníte osobní údaje, kontakt, doklady a benefity. Podle **národnosti** se zobrazí buď sekce *OP* (občané ČR), nebo *Pas + Povolení k pobytu* (cizinci).

- **Reaktivace ukončeného zaměstnance:** pokud zadáte jméno a datum narození, které odpovídá již existujícímu **ukončenému** zaměstnanci, aplikace nabídne *„Reaktivovat a upravit údaje"* (otevře profil existujícího zaměstnance k úpravě — pracovní poměr *Nástup* pak přidáte ručně v historii), *„Přesto vytvořit nového"*, nebo *Zrušit*. Tím se zabrání duplicitám.

### Detail zaměstnance

Detail má tři záložky — **Detail** (osobní a kontaktní údaje), **Historie pracovního poměru** a **Další dokumenty**.

- **Citlivé údaje** (rodné číslo, číslo OP, číslo pojištěnce, bankovní účet) jsou skryté; zobrazíte je kliknutím na ikonu oka. **Každé zobrazení se zaznamenává do Logu změn.**
- **Telefon** začínající `+420` se zobrazuje po skupinách jako `+420 XXX XXX XXX` (jen zobrazení, uložené číslo se nemění).
- Má-li zaměstnanec ve formuláři zaškrtnuto **„Nepodepíše prohlášení poplatníka"**, pod záhlavím detailu se zobrazí informační pruh **„Nepodepsané prohlášení"**.
- **Upravit** otevře editaci údajů. V sekci **Benefity** je zaškrtávátko **„Nepodepíše prohlášení poplatníka"**.

> 📷 *(Místo pro snímek obrazovky: detail zaměstnance)*

##### Benefity — Multisport

Multisport se spravuje přímo na detailu zaměstnance v sekci **Benefity** tlačítkem **„Spravovat"** (dřívější zaškrtávátko Multisport se dvěma daty ve formuláři zaměstnance už není — správa se přesunula sem).

- Lze zadat **více období Multisport** (datum *od* / *do*; pole *do* můžete nechat prázdné = členství trvá).
- Lze přidat i **doprovodné Multisport karty** (parametry: **jméno, od, do, cena**), klidně více najednou.

#### Historie pracovního poměru

Pracovní poměr je členěn na **sezení (sessions)** — každé začíná **Nástupem**, může obsahovat **Dodatky** (změna mzdy, pozice, úvazku, délky smlouvy) a končí **Ukončením**.

- **+ Přidat změnu** (Nástup / Dodatek / Ukončení).
- U řádku **Nástup** se u smluv HPP a PPP zobrazuje **nástupní mzda** (skrytá, zobrazíte ji ikonou oka — stejně jako u mzdových Dodatků). U DPP a řádků bez mzdy se mzda nezobrazuje.
- Mzda a pozice v záhlaví poměru se mění až **k datu platnosti Dodatku**.
- **Automatický přesun do „Ukončení":** zaměstnanec se do záložky *Ukončení* přesune sám, jakmile **uplyne datum ukončení** (smlouva na dobu určitou nebo zadané ukončení). Den ukončení je ještě aktivní — přesun proběhne až následující den. Naopak zaměstnanec s budoucím nástupem se zobrazuje v záložce **Před nástupem** a do záložky **Aktivní** se přesune automaticky **v den nástupu**.
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

Měsíční plán směn (recepce, portýři, Management). Plán je rozčleněn do sekcí oddělených záhlavím; první sekce nese název **Management**. Souhrnné řádky Σ na konci každé sekce byly odstraněny — plán je tak přehlednější a záhlaví sekcí slouží jako přirozené oddělovače.

### Životní cyklus plánu

Plán prochází stavy **Vytvořený → Otevřený → Uzavřený → Publikovaný** (jednosměrně). Přechody mohou být automatické podle nastavených termínů, nebo je spouštíte ručně.

- **Vytvoření plánu, přechody mezi stavy, nastavení termínů a kopírování zaměstnanců z předchozího plánu** děláte vy (administrátor i ředitel).
- **Termíny všech tří přechodů (Otevření, Uzavření, Publikování) můžete nastavit už ve stavu *Vytvořený*** — plán se pak postupně posune sám, jak jednotlivé termíny nastanou. Termíny musí jít po sobě (Otevření ≤ Uzavření ≤ Publikování).
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
- **Řazení recepce / portýři:** denní (`D`/`DP`) jsou vždy nahoře, noční (`N`/`NP`) dole, oddělené silnější čarou. Ruční pořadí platí v rámci každé skupiny. Stejné řazení má i export do PDF a CSV.

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
- Pokud termín koliduje s již naplánovanou směnou, žádost je **zablokována** s upozorněním.

> **Poznámka:** Přehled **Schválené dovolené (všichni zaměstnanci)** se vám nezobrazuje — jako administrátor/ředitel vidíte veškeré schválené dovolené (včetně vedení) přímo v tabulce **Všechny žádosti** výše. Tato samostatná tabulka se zobrazuje pouze uživatelům, kteří nemají přístup ke všem žádostem.

> **Tip:** Má-li **FOM (Vedoucí)** vidět **veškerou** schválenou dovolenou včetně vedení (administrátor, ředitel), přidělte jeho **typu uživatele** oprávnění **„Zobrazit všechny žádosti"** v *Nastavení → Uživatelské typy*. (Oprávnění „Zobrazit schválené dovolené kolegů" ukazuje pouze dovolené řadových zaměstnanců, ne management.)

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

> 📝 Upozornění na **Doklady** a **Zkušební dobu** se nevytvářejí pro zaměstnance se statusem **Ukončení** (ukončený pracovní poměr). Zaměstnanci v záložce **Před nástupem** (budoucí nástup) upozornění dostávají normálně.

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
- **Mzdy** — sazba stravenky, maximální měsíční odměna DPP, **minimální mzda** a **základní cena Multisport** (výchozí 470 Kč/měsíc). U jednotlivých polí se zobrazuje jen vysvětlující text, nikoli již dřívější údaj *„Výchozí hodnota: …"*.
- **Menu** — pořadí položek v levém menu pro jednotlivé **typy uživatelů**.
- **Uživatelé** — vytváření a správa uživatelských účtů: vytvoření (i bez hesla s odkazem pro reset), úprava jména/e-mailu, volba **typu uživatele** (sloupec *Typ*), **úprava oprávnění** (viz níže), deaktivace a reaktivace, reset hesla, propojení účtu se zaměstnancem. Neaktivní účty jsou dole; při vytvoření účtu se stejným e-mailem jako neaktivní účet se nabídne jeho reaktivace.
- **Uživatelské typy** — správa typů uživatelů a jejich oprávnění (viz níže); záložka je hned za **Uživatelé**.
- **Úlohy** — ruční spuštění automatických denních úloh (viz níže).

> 📷 *(Místo pro snímek obrazovky: Nastavení)*

### Uživatelské typy

Záložka **Uživatelské typy** umožňuje spravovat **typy uživatelů** (např. *Administrátor*, *Ředitel*, *FOM*, *Zaměstnanec*, *Účetní*, *Personalista*) a přesně určit, co každý typ smí. To, co dříve bylo pevně dané rolí, je nyní **plně nastavitelné**.

- Seznam ukazuje všechny typy s odznaky **systém** (chráněný typ), **vedení** (drží práva managementu) a **počtem oprávnění**.
- Po výběru typu se zobrazí **přehledná matice oprávnění** seskupená podle oblastí (zaměstnanci, mzdy, směny, smlouvy…), kde zaškrtnutím/odškrtnutím povolíte nebo zakážete jednotlivá oprávnění. Dále lze upravit **název** typu a přepínač **„Vedení"** (zda se držitelé typu počítají jako management).
- **Nový typ** vytvoříte buď **zkopírováním** existujícího typu (převezme jeho oprávnění), nebo jako **„Prázdný (bez práv)"** (po potvrzení).
- **Smazat typ** lze tlačítkem pro odstranění. Systémový typ **„Administrátor" smazat nelze**; typ, který je ještě přiřazen některým uživatelům, nelze smazat, dokud je nepřevedete na jiný typ.
- Typ **„Administrátor" je pouze ke čtení** — nelze ho upravit ani smazat a má vždy všechna oprávnění.

> 📷 *(Místo pro snímek obrazovky: Uživatelské typy)*

### Oprávnění uživatele

V záložce **Uživatelé** je u každého uživatele tlačítko **„Oprávnění"**. Otevře dialog, kde:

- z rozbalovacího seznamu vyberete **typ uživatele** (tím nastavíte výchozí sadu oprávnění),
- a navíc můžete **doladit jednotlivá oprávnění** nad rámec typu — zaškrtnutím či odškrtnutím konkrétního oprávnění, které se liší od typu, vznikne **individuální výjimka** (přidání či odebrání práva), označená tečkou (●).

Pojistky: **nemůžete si odebrat vlastní administrátorská práva** a **posledního administrátora nelze degradovat**.

> 📷 *(Místo pro snímek obrazovky: Oprávnění uživatele)*

> **Poznámka:** sloupec **„Typ"** rychle změní typ uživatele přímo v seznamu; tlačítko **„Oprávnění"** umožní navíc doladit jednotlivá práva (typ + individuální výjimky). Skutečná oprávnění uživatele určuje právě tato kombinace.

> 📝 **Zobrazení v seznamu uživatelů:** Jméno propojeného zaměstnance se zobrazuje u každého uživatele vždy. Sloupec *Typ* zobrazuje buď rozbalovací seznam pro změnu typu (pokud máte oprávnění typ měnit), nebo prostý textový popisek aktuálního typu (pokud toto oprávnění nemáte). **Propojení účtu se zaměstnancem** (tlačítko v řádku uživatele) je nově podmíněno samostatným oprávněním **„Propojit zaměstnance s účtem"** — bez tohoto oprávnění tlačítko pro propojení/odpojení nevidíte.

### Úlohy

Záložka **Úlohy** umožňuje ručně spustit automatické denní úlohy, které jinak systém spouští sám každý den na pozadí. Využijete ji například po výpadku služby nebo tehdy, kdy potřebujete, aby se data okamžitě aktualizovala bez čekání na noční běh.

Dostupné úlohy:

- **Přechody stavů plánů směn** — zkontroluje nastavené termíny a posune plány do dalšího stavu (Otevřený / Uzavřený / Publikovaný), pokud termín již nastal.
- **Údržba Multisportu** — zkontroluje a zaktualizuje stav členství Multisport u všech zaměstnanců.
- **Upozornění na zkušební doby** — znovu vyhodnotí, zda se u zaměstnanců blíží konec zkušební doby, a obnoví příslušná upozornění.
- **Upozornění na doklady** — znovu vyhodnotí, zda se blíží expirace dokladů zaměstnanců, a obnoví příslušná upozornění.
- **Přepočet aktuálních údajů zaměstnanců** — aktualizuje souhrnné hodnoty v evidenci zaměstnanců (např. délka poměru, aktuální stav smlouvy).

Každou úlohu spustíte tlačítkem **Spustit** u jejího názvu. Před spuštěním se zobrazí potvrzovací dialog — potvrďte jej. Každý ruční spuštění se zaznamenává do **Logu změn**.

> ⚠️ Ruční spuštění úlohy zpravidla nemá žádné vedlejší účinky — přepočítává jen odvozená data, která lze kdykoli znovu vygenerovat. Přesto jej spouštějte záměrně; zbytečné opakované spouštění za sebou není potřeba.

> 📷 *(Místo pro snímek obrazovky: záložka Úlohy)*
