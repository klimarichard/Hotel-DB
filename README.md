# HPM Intranet

HPM Intranet is a cloud-based HR platform for **Special Tours Prague (STP)** and **Hotel Property Management (HPM)**, two Czech hospitality companies. It replaces a stack of Excel workbooks with a single web application for employee records, contract generation, shift planning, vacation tracking, and payroll.

The application UI is in **Czech**. This README and the developer documentation are in English; the end-user manuals are in Czech.

## Features

- **Employees** — central records with AES-256-GCM-encrypted sensitive fields, session-based employment history (Nástup → Dodatek → Ukončení, only one active parental leave per employee at a time, with signing-date sanity warnings), three-tab lifecycle (Před nástupem → Aktivní → Ukončení with automatic date-driven transitions), document-expiry alerts, CSV export, and a blank printable questionnaire.
- **Contracts & templates** — a Word-like (TipTap) template editor with variables and conditional blocks; contracts are generated server-side as PDFs, with signing-date sanity warnings (weekends, public holidays, or a date later than the document's validity).
- **Shifts** — a monthly shift planner with a shift-expression parser, plan lifecycle (Created → Opened → Closed → Published), MOD (manager-on-duty) tracking, change requests, X-limit rules, exact deadline timestamps for users without deadline-edit rights, and a countdown to crossing-out (vyškrtávání) start for a plan that hasn't opened yet.
- **Vacation** — request/approval workflow with automatic shift-collision handling, plus an hour-based yearly balance (nárok / čerpáno / zůstatek) on each employee's record that auto-fills from locked payroll periods and can be corrected by hand with the right permission.
- **Payroll** — monthly computation from the published shift plan, manual adjustments, notes, period locking, and PDF export.
- **Dashboard, alerts & audit** — a per-role dashboard (Přehled), an alerts hub (Upozornění), and a complete change log (Log změn).
- **Recepce** — a permission-driven front-desk hub per hotel (Ambiance, Superior, Amigo & Alqush, Ankora): a shift handover protocol (cash counting, accounts, notes, signature-based handover), a walk-in sales log, and a taxi-ride log with commission tracking and a shared route price list.
- **Onboarding tour & help** — a guided first-login tour (auto-starts once, fully replayable from Nápověda) that spotlights controls based on each user's permissions; section-jump navigation lets users skip ahead or back a whole page at a time; returning users who have already completed the tour see only a short "Co je nového" card for newly-added features rather than the full tour again; a searchable Nápověda reference page whose step list is directly clickable, jumping the tour straight to that step; all permission-driven with no per-role duplicates.
- **Administration** — companies, job positions, departments, and education levels (grouped as collapsible sections under a single Settings → Seznamy tab), payroll settings, user management, per-role menu ordering, and manual job triggers (Settings → Úlohy).

Granular permission-based access control gates every screen, route, and API endpoint.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | Firebase Cloud Functions (Express) — `functions/` |
| Database | Firestore (NoSQL) |
| Auth | Firebase Auth with custom role claims |
| File storage | Firebase Storage |
| Contract PDFs | TipTap editor + server-side Puppeteer |
| Encryption | AES-256-GCM (Cloud Functions) |

## Roles

`admin` · `ředitel` (director) · `FOM` (manager / front office manager) · `zaměstnanec` (employee) · `účetní` (accountant)

> Typy uživatelů jsou konfigurovatelná data — administrátor je spravuje v Nastavení → Uživatelské typy. Výše uvedené jsou výchozí vestavěné typy; lze přidávat vlastní (např. „Revenue & Rezervace“).

## User manuals (Czech)

Per-role manuals — each covers **only** what that role can do in the app. (These may later be surfaced as in-app help.)

- [Administrátor a ředitel](manuals/admin-a-reditel.md)
- [FOM (vedoucí)](manuals/vedouci.md)
- [Zaměstnanec](manuals/zamestnanec.md)
- [Účetní](manuals/ucetni.md)

> When a new role is added, add a matching manual under `manuals/`.

## Recepce (uživatelská příručka)

Přístup do sekce **Recepce** není vázaný na jednu konkrétní roli — řídí se výhradně **oprávněními**, která administrátor přidělí uživatelskému typu nebo jednotlivému uživateli (Nastavení → Uživatelské typy). Recepci proto může mít otevřenou recepční, FOM i ředitel, podle toho, co jim bylo přiděleno. Z toho důvodu je popsána přímo zde, a ne v jedné z příruček výše.

> 📷 *(Místo pro snímek obrazovky: hub Recepce s lištou hotelů a záložkami)*

> 📝 **Sdílený terminál:** Pracuje-li na některém pracovišti víc lidí ze společného účtu (typicky recepce), může administrátor v Nastavení → Uživatelské typy zapnout u příslušného uživatelského typu volbu **„Sdílený terminál"**. Je-li zapnutá, zápisy provedené v Recepci (protokol, Walkiny, Taxi) se v historii i v Logu změn nepřiřadí společnému účtu, ale osobě, která na protokolu předchozí směny podepsala **Převzal**. Manažer nebo administrátor přihlášený pod svým vlastním účtem se podepíše vždy sám za sebe. Pokud protokol pro předchozí směnu neexistuje nebo není podepsaný, použije se přihlášený účet.

### Otevření Recepce a výběr hotelu

1. V levém menu klikněte na položku **Recepce**. Položka se v menu zobrazí jen uživatelům, kteří mají alespoň jedno oprávnění v této sekci — pokud ji nevidíte, obraťte se na administrátora.
2. Nahoře se zobrazí lišta s hotely, ke kterým máte přístup — **Ambiance**, **Superior**, **Amigo & Alqush** a **Ankora**. Kliknutím na název hotelu jej vyberete; vybraný hotel je barevně zvýrazněný.
   - Máte-li přístup jen k jednomu hotelu, lišta se přesto zobrazuje (abyste vždy viděli, na kterém hotelu právě pracujete), a aplikace vás rovnou otevře v něm.
3. Pod lištou hotelů se zobrazí záložky dostupné pro vybraný hotel — typicky **Předávací protokol**, **Walkiny** a **Taxi**. Nabídka záložek se liší hotel od hotelu podle toho, jaká oprávnění máte.
4. Kliknutím na záložku otevřete danou sekci.

**Výchozí hotel** – máte-li přístup k více než jednomu hotelu, vedle lišty hotelů se zobrazuje tlačítko **☆ Nastavit jako výchozí** / **★ Výchozí hotel**. Kliknutím určíte, který hotel se vám má v Recepci otevírat jako první – vybraný hotel je pak v liště označen hvězdičkou ★. Nastavení je uloženo k vašemu účtu, takže platí i po odhlášení nebo na jiném počítači. Administrátor může výchozí hotel nastavit i za vás, v Nastavení → Uživatelé → tlačítko **„Upravit"** u daného uživatele, výběrem z pole **„Výchozí hotel v Recepci"**.

- Přímý odkaz na konkrétní hotel (např. z historie prohlížeče nebo záložky) má vždy přednost před výchozím hotelem.
- Bez nastaveného výchozího hotelu se vám při vstupu do Recepce otevře naposledy použitý hotel.

> 📝 Nemáte-li přístup k žádnému hotelu, zobrazí se hláška „Žádný přístupný hotel" – obraťte se na administrátora.

### Předávací protokol

Předávací protokol eviduje hotovost, účty a poznámky pro jednu konkrétní směnu (den + **Den**/**Noc**) a slouží k formálnímu předání směny mezi dvěma zaměstnanci pomocí podpisu.

**Výběr směny**

- V horní liště zvolte **datum** a typ směny — **Den** nebo **Noc**.
- Tlačítky **← Předchozí** a **Následující →** se posouváte na sousední směnu (den ↔ noc, včetně přechodu přes půlnoc).

**Vytvoření protokolu**

- Pokud pro zvolenou směnu ještě žádný protokol neexistuje, zobrazí se tlačítko **Vytvořit prázdný protokol** – ale jen tehdy, když protokol pro **předchozí** směnu buď neexistuje, nebo ještě není podepsaný. Tlačítko vidí jen uživatelé s oprávněním protokol vytvářet. Kliknutím vznikne prázdný protokol připravený k vyplnění.
- Je-li protokol pro **předchozí** směnu už podepsaný, tlačítko **Vytvořit prázdný protokol** se nenabízí – nový protokol se v tom případě zakládá z předchozí směny tlačítkem **Vytvořit protokol pro další směnu** (viz „Protokol pro další směnu" níže), které převede hotovost, účty i nedokončené poznámky.

**Počítání hotovosti — KASA a TREZOR**

- Protokol obsahuje čtyři samostatné tabulky: **KASA CZK**, **TREZOR CZK**, **KASA €** a **TREZOR €**.
- U každého nominálu (bankovky a mince) zadejte **počet kusů** — aplikace sama dopočítá mezisoučet (nominál × počet kusů) i celkový součet dané tabulky (**CELKEM**).
- Součty KASA, TREZOR i celková hodnota v CZK a EUR se zobrazují v souhrnu nad seznamem účtů.

**Účty**

- Tlačítkem **+ Přidat účet** přidáte nový řádek, zadáte jeho **název** a **částku** v Kč.
- U každého řádku můžete přes ikony tužky a koše záznam **upravit** nebo **smazat**.
- Uživatelé s oprávněním **Spravovat protokol** mohou řádek navíc **uzamknout** ikonou zámku — uzamčený řádek pak nejde upravit ani smazat nikým jiným, dokud jej stejný uživatel znovu neodemkne.
- **Uzamčené účty se řadí nad všechny nezamčené** (pod třemi speciálními řádky) a oddělují se od nich vodorovnou čárou, aby byly dobře vidět.
- Nad běžnými účty jsou natrvalo tři speciální řádky:
  - **sm** — hodnota se počítá automaticky z počtu kusů zadaných po kliknutí na řádek; sazby nastavují uživatelé s oprávněním **Spravovat sm**.
  - **sm trezor** — částka převedená z „sm" do trezoru; vynulovat ji (po fyzickém odvedení hotovosti) mohou uživatelé s oprávněním **Spravovat sm**. Ostatním se řádek zobrazí, jen má-li nenulovou hodnotu.
  - **wata** — ruční přičtení nebo odečtení částky; upravují jej uživatelé s oprávněním **Spravovat protokol**. Ostatním se řádek zobrazí, jen má-li nenulovou hodnotu.
- Řádek **CELKEM** na konci sečte všechny účty včetně sm, sm trezor a wata.

**Poznámky**

- V panelu **Poznámky** přidáte poznámku tlačítkem **+ Přidat poznámku**.
- Zaškrtávacím políčkem označíte poznámku jako **vyřízenou** (přeškrtne se).
- Poznámku lze stejně jako účet upravit, smazat a uživatelé s oprávněním **Spravovat protokol** ji mohou uzamknout. **Uzamčené poznámky se řadí nad všechny nezamčené** a oddělují se od nich vodorovnou čárou.
- Do protokolu pro navazující směnu (tlačítko **Vytvořit protokol pro další směnu**, viz níže) se přenášejí jen **nedokončené** poznámky. Poznámka odškrtnutá jako vyřízená zůstává u směny, ve které byla dokončena, a dál se nepřenáší – ani jako přeškrtnutá.

**Předání směny (podpis)**

- Jakmile je protokol vyplněný, směnu **předáte** podpisem: klikněte na **Předat** u pole *Předal*, v okně vyberte své **jméno** a zadejte **heslo** — tím potvrdíte, že podpis provádíte skutečně vy. Po potvrzení se u pole *Předal* zobrazí vaše jméno a čas podpisu.
- Kolega přebírající směnu obdobně klikne na **Převzít** u pole *Převzal* a potvrdí svým jménem a heslem.
- **Jakmile je protokol podepsaný alespoň jednou stranou** (Předal nebo Převzal), **obsah se uzamkne** a dál jej nelze upravovat — výjimkou je administrátor. Krok **Zpět/Vpřed** (viz níže) je po podpisu zamčený pro úplně všechny, administrátora nevyjímaje.
- Podpis lze odebrat kliknutím na ikonu koše u jména — smí to udělat sám podepsaný, nebo uživatel s oprávněním **Spravovat protokol**/administrátor. Podpis *Předal* lze odebrat, jen dokud není podepsáno *Převzal*.

> ⚠️ Po podpisu obsah protokolu (hotovost, účty, poznámky) neupravujte, nejste-li administrátor — podepsaná verze má zůstat finální záznam o směně.

**Protokol pro další směnu**

- Po podpisu *Převzal* se objeví tlačítko **Vytvořit protokol pro další směnu** – vytvoří přesnou kopii aktuálního protokolu (hotovost, účty, **nedokončené** poznámky, bez podpisů) pro navazující směnu a rovnou vás do ní přepne. Tlačítko se nezobrazí, pokud protokol pro další směnu už existuje.

**Historie změn a krok zpět/vpřed**

- Tlačítkem **Historie** otevřete panel se seznamem provedených změn (kdo, co a kdy změnil) v chronologickém pořadí.
- Vytvoření protokolu se do historie zapíše jako jediný záznam – „Protokol vytvořen" (u prázdného protokolu), nebo „Protokol vytvořen převzetím z předchozí směny" (u protokolu založeného tlačítkem **Vytvořit protokol pro další směnu**). Tento záznam nejde vrátit tlačítkem **↶ Zpět** – protokol jako celek lze pouze nevratně smazat tlačítkem **Smazat protokol**.
- Psaní textu (poznámka, název nebo částka účtu) se do historie zapisuje jako **jeden záznam za celou úpravu**, ne po jednotlivých znacích. Úprava je uzavřena ve chvíli, kdy z pole odejdete – kliknete jinam, přejdete tabulátorem dál, nebo úpravu ukončíte tlačítkem **✓ Hotovo**. Vrátíte-li se do stejného pole později, začíná nová úprava a vznikne nový záznam. Jedno kliknutí na **↶ Zpět** vrátí celou úpravu najednou. Napíšete-li text a poté ho smažete zpět na původní hodnotu, v historii po této úpravě nezůstane žádný záznam.
- Dokud protokol není podepsaný, jsou k dispozici tlačítka **↶ Zpět** a **↷ Vpřed** – vrátí, respektive znovu provedou poslední změnu. Po podpisu jsou nedostupná pro všechny.

**Tisk**

- Jakmile jsou podepsané **obě** strany (*Předal* i *Převzal*), zobrazí se tlačítko **Tisk** — otevře přehlednou černobílou tiskovou sestavu protokolu na jednu stránku A4.

**Smazání protokolu**

- Uživatelé s oprávněním protokol **mazat** vidí tlačítko **Smazat protokol**. Po potvrzení se protokol nevratně smaže — použijte jen výjimečně, například při omylem založeném protokolu.

> 📷 *(Místo pro snímek obrazovky: Předávací protokol s hotovostí, účty a podpisy)*

### Walkiny

Záložka **Walkiny** eviduje prodeje typu „walk-in" — zákazník bez rezervace přijde přímo na recepci.

- Tabulka zobrazuje **datum**, **zaměstnance**, **číslo rezervace v Protelu** a **částku** (v Kč nebo €), řazeno od nejnovějšího záznamu.
- Nový záznam přidáte tlačítkem **+ Přidat walk-in**: vyberete **datum**, **zaměstnance** (nabídka se plní ze zaměstnanců naplánovaných na směnu ve zvoleném měsíci), zadáte **číslo rezervace**, **částku** a **měnu**. Pole **zaměstnanec** se předvyplní tím, kdo má právě teď službu na recepci daného hotelu (stejně jako se v Předávacím protokolu předvyplňuje podpis) — v případě potřeby jej lze změnit.
- Existující záznam upravíte nebo smažete ikonami tužky a koše u řádku.
- Uživatelé s oprávněním **Spravovat walkiny** navíc nastavují **viditelné období** (rozsah od–do) — tím určují, jaké datum smí ostatní uživatelé zadat a jaké záznamy vidí. Bez tohoto oprávnění vidíte jen informační řádek s aktuálně nastaveným obdobím.

> 📷 *(Místo pro snímek obrazovky: tabulka Walkiny)*

### Taxi

Záložka **Taxi** eviduje objednané taxi jízdy hotelových hostů včetně provize.

- Tabulka zobrazuje **datum, čas, pokoj, počet osob (PAX), destinaci, částku, provizi** a **poznámku**, řazeno od nejnovější jízdy.
- Novou jízdu přidáte tlačítkem **+ Přidat jízdu**:
  - **Destinaci** vyberte z **ceníku tras** (viz níže), nebo zvolte **„Jiné…"** pro trasu mimo ceník.
  - U trasy z ceníku se **částka a provize doplní automaticky** a nejdou ručně přepsat. U trasy typu round-trip (zpáteční) navíc není povinné zadávat čas.
  - U volby **„Jiné…"** musíte zadat **částku** ručně a je povinná i **poznámka** popisující trasu.
  - Pokoj a počet osob jsou nepovinné.
- Existující jízdu upravíte nebo smažete ikonami tužky a koše.
- Uživatelé s oprávněním **Spravovat taxi** nastavují **viditelné období** (obdobně jako u Walkin) a navíc vidí nad tabulkou souhrn **Celková provize za viditelné období** — součet provizí ze všech jízd spadajících do nastaveného období.
- Vpravo je panel **Ceník tras** se seznamem tras, jejich **cenou**, **provizí** a příznakem zpáteční jízdy (↺). Uživatelé s oprávněním **Spravovat ceník taxi** zde tlačítkem **Upravit** otevřou editaci ceníku — mohou trasy přidávat, přejmenovávat, měnit cenu/provizi, přeřazovat pořadí šipkami nebo mazat. Ceník je společný pro všechny hotely.

> 📷 *(Místo pro snímek obrazovky: Taxi — tabulka jízd a ceník tras)*

### Lobby bar

Záložka **Lobby bar** (jen hotel **Ambiance**) eviduje prodeje z lobby baru.

- Tabulka zobrazuje **datum, položku, počet, měnu, kdo prodal, cenu, provizi** a **částku do společné**, řazeno od nejnovějšího záznamu.
- Nový prodej přidáte tlačítkem **+ Přidat prodej**: nahoře zvolíte **datum** a kdo **prodal** – tyto údaje platí pro celý prodej. Pole **Prodal** se předvyplní tím, kdo má právě teď službu na recepci (stejně jako podpis v Předávacím protokolu); lze jej změnit. Pod nimi vyplníte jednotlivé položky, u každé **položku** z ceníku, **počet** kusů a **měnu** (Kč nebo €).
- **Jedním prodejem lze zapsat i více položek najednou** (např. 2× pivo a 1× víno pro stejného hosta). Tlačítkem **+ Přidat položku** přidáte další řádek, ikonou koše řádek odeberete.
- **Měna se volí u každé položky zvlášť**, takže v jednom prodeji můžete mít část v korunách a část v eurech. Náhled dole ukazuje celkovou cenu, provizi a částku do společné **odděleně za koruny a za eura** – měny se nikdy nesčítají dohromady.
  - Po uložení se **každá položka zapíše do tabulky jako samostatný řádek**, takže ji lze později zvlášť upravit nebo smazat. Buď se uloží všechny řádky, nebo (při chybě) žádný – nikdy jen část.
  - Při **úpravě** už zapsaného prodeje se edituje vždy jen ten jeden řádek.
- **Cena, provize a částka do společné se dopočítají samy** a nejdou zadat ručně:
  - **Cena** = počet kusů × cena položky v dané měně.
  - **Provize** = počet kusů × sazba za kus (výchozí **20 Kč**, resp. **1 €**).
  - **Do společné** = cena minus provize.
- Koruny a eura se mezi sebou nikdy nepřepočítávají – prodej zadaný v eurech se celý počítá v eurech.
- Vpravo je panel **Ceník položek** – u každé položky je uvedena cena v Kč i v €. Uživatelé s oprávněním **„Spravovat lobby bar"** zde tlačítkem **Upravit** otevřou editaci ceníku, včetně sazeb provize.
- Změna ceníku **neovlivní už zapsané prodeje** – u nich zůstává v platnosti cena, která platila v okamžiku prodeje.
- Uživatelé s oprávněním **„Spravovat lobby bar"** navíc v ceníku vidí sloupec **Prodáno** – u každé položky je součet prodaných kusů. Vedle tlačítka **Upravit** je červené tlačítko **Reset**: po potvrzení se všechna čísla ve sloupci **Prodáno** vynulují a počítání začne znovu od té chvíle. **Zapsané prodeje se nesmažou** – jen se posune okamžik, od kterého se počítá.
- Uživatelé s oprávněním **„Spravovat lobby bar"** také nastavují **viditelné období** a vidí nad tabulkou souhrny provize a částky do společné, samostatně pro koruny a eura.

> 📷 *(Místo pro snímek obrazovky: Lobby bar – tabulka prodejů a ceník položek)*

### Terminál

Záložka **Terminál** (jen hotel **Amigo & Alqush**) eviduje platby z platebního terminálu.

- Tabulka zobrazuje **datum, částku, typ** a **poznámku**; uživatelům s oprávněním **„Spravovat terminál"** se navíc zobrazí sloupec **Předáno**.
- Novou platbu přidáte tlačítkem **+ Přidat platbu**: zadáte **datum**, **částku** v korunách a **typ** transakce z nabídky. U volby **„Jiné…"** je **poznámka povinná** – popíšete v ní, o jakou platbu šlo, jinak by to z tabulky nešlo poznat. U ostatních typů je poznámka nepovinná.
- Uživatelé s oprávněním **„Spravovat terminál"** vidí vpravo panel **Typy plateb** se seznamem typů (obdobně jako ceník u Taxi a Lobby baru). Tlačítkem **Upravit** v tomto panelu otevřou editor, kde mohou typy **přidávat, přejmenovávat, mazat a přeřazovat**. Typ **„Jiné…"** je vždy k dispozici a nelze jej odstranit. Přejmenování nebo smazání typu **neovlivní už zapsané platby** – u nich zůstane název, který platil v okamžiku zápisu. Panel i editor vidí jen uživatelé s tímto oprávněním.
- Sloupec **Předáno** se zaškrtávacím políčkem vidí a mění jen uživatelé s oprávněním **„Spravovat terminál"** – zaznamená se, kdo a kdy platbu předal.
- Uživatelé s oprávněním **„Spravovat terminál"** také nastavují **viditelné období**.

> 📝 Celkové součty za jednotlivé typy plateb zatím nejsou k dispozici; doplní se později.

> 📷 *(Místo pro snímek obrazovky: Terminál – tabulka plateb)*

> 📝 Záložky **Lobby bar** i **Terminál** se zobrazí jen uživatelům s příslušným oprávněním, a to jen u hotelu, kterému náleží.

## Návody (uživatelská příručka)

Sekce **Návody** je knihovna instruktážních materiálů pro zaměstnance – PDF návody a odkazy na externí zdroje (například sdílenou složku na Google Drive nebo video). Všechny návody tvoří jeden společný seznam; každý z nich může mít libovolný počet **štítků** (např. „Recepce", „Mzdy", „Protel") a jeden návod tak může patřit pod více témat najednou. Přístup se řídí oprávněním **„Zobrazit Návody"**, které mají v praxi přidělené všichni uživatelé, takže položku **Návody** v levém menu vidí téměř každý – pokud ji nevidíte, obraťte se na administrátora.

> 📷 *(Místo pro snímek obrazovky: stránka Návody s vyhledávacím polem, štítky a seznamem návodů)*

### Otevření Návodů a hledání

1. V levém menu klikněte na položku **Návody**.
2. Zobrazí se stránka s vyhledávacím polem **„Hledat v názvech, popisech a štítcích…"**, pod ním řádek klikacích **štítků** a pod tím seznam všech návodů.
3. U každého návodu vidíte ikonu podle typu – 📄 pro PDF soubor, 🔗 pro odkaz –, jeho **název**, případně krátký **popis** a jeho **štítky**.

> 📝 Seznam je vždy seřazený **abecedně podle názvu** (řazení respektuje české abecední pořadí, takže „Č" je hned za „C") a o pořadí se není třeba nijak starat – když se návod přidá, přejmenuje nebo smaže, seznam se automaticky přeřadí sám.

Hledání a filtrování podle štítků lze libovolně kombinovat:

- Do vyhledávacího pole napište libovolné slovo nebo jejich část – hledá se v **názvu**, **popisu** i **štítcích** návodu a nezáleží na diakritice (např. „uzaverka" najde i „Uzávěrka"). Napíšete-li víc slov, výsledek se zpřesňuje – zobrazí se jen návody, které obsahují všechna zadaná slova.
- Kliknutím na některý ze **štítků** v řádku nad seznamem (nebo přímo na štítek u konkrétního návodu) zobrazíte jen návody s tímto štítkem. Kliknutím na další štítek výběr dál zúžíte – zobrazí se jen návody, které mají **všechny** vybrané štítky najednou. Aktivní štítek poznáte podle zvýraznění; dalším kliknutím na něj filtr zase zrušíte.
- Tlačítko **Zrušit filtr** (zobrazí se, jen když je hledání nebo filtr aktivní) najednou vymaže zadaný text i všechny vybrané štítky.

> 📝 Pokud zatím nejsou v sekci žádné návody, zobrazí se místo seznamu jen informační hláška. Pokud návody existují, ale žádný neodpovídá zadanému hledání nebo štítkům, zobrazí se hláška „Žádný návod neodpovídá hledání."

### Otevření návodu

Kliknutím na název (nebo kdekoli na řádek) daného návodu jej otevřete. Chování se liší podle typu:

- **PDF soubor** se otevře přímo v aplikaci v novém okně – návod si v něm můžete prohlížet, posouvat a přibližovat. V zápatí okna jsou dvě tlačítka: **Stáhnout** (uloží PDF do počítače) a **Otevřít v novém okně** (otevře stejný soubor v samostatné záložce prohlížeče). Okno zavřete tlačítkem **Zavřít** nebo ikonou ✕ vpravo nahoře.
  > 📝 Na mobilním telefonu se PDF návody uvnitř aplikace nezobrazují spolehlivě, proto se místo náhledu nabídne jen tlačítko **Otevřít návod**, které soubor otevře v PDF prohlížeči telefonu.
- **Odkaz** se otevře v nové záložce prohlížeče – jde o stránku mimo aplikaci (např. sdílenou složku nebo video), takže se řídí pravidly daného externího webu.

> 📷 *(Místo pro snímek obrazovky: otevřený PDF návod v prohlížeči uvnitř aplikace)*

### Správa návodů (jen s oprávněním „Spravovat návody")

Uživatelé s oprávněním **„Spravovat návody"** (typicky administrátor nebo ředitel) navíc vidí tlačítko **Nový návod** a u každého návodu tlačítka pro úpravu a mazání.

1. Nový návod založíte tlačítkem **Nový návod** nahoře na stránce.
2. Zvolíte **typ** – **PDF soubor**, nebo **Odkaz**. Typ jde zvolit jen při zakládání; u již vytvořeného návodu jej později změnit nelze.
3. Vyplníte **název** návodu a nepovinný **popis** (krátká vysvětlivka, která se zobrazí pod názvem v seznamu).
4. Přidáte **štítky**: do pole pro štítky napíšete text a potvrdíte klávesou **Enter** – štítek se přidá jako samostatná bublina se symbolem ✕ pro odstranění. Během psaní se pod polem nabízejí už existující štítky, které odpovídají napsanému textu – kliknutím na některý z nich jej rovnou přidáte, aniž byste jej museli dopisovat celý. Stisknete-li klávesu **Backspace** v prázdném poli pro štítky, odebere se poslední přidaný štítek. Návod může mít libovolný počet štítků, i žádný.
5. Podle zvoleného typu buď:
   - u **PDF souboru** kliknete na pole pro výběr souboru a vyberete PDF z počítače (maximální velikost **7 MB**), nebo
   - u **Odkazu** vložíte plnou webovou adresu (např. `https://drive.google.com/…`).
6. Uložíte tlačítkem **Uložit**, nebo rozpracovaný formulář zavřete tlačítkem **Zrušit**.

> 📝 U existujícího PDF návodu lze při úpravě (tlačítko **Upravit**) nahrát nový soubor přes pole **„Nahradit PDF (nepovinné)"** – ponecháte-li ho prázdné, zůstane uložen původní soubor.

- Existující návod upravíte tlačítkem **Upravit** (otevře stejný formulář jako při zakládání, předvyplněný včetně štítků) nebo smažete tlačítkem **Smazat** – smazání je nevratné.

> 📝 Pořadí návodů v seznamu se nedá nastavit ručně – seznam se řadí sám podle abecedy (viz výše), takže nově založený nebo přejmenovaný návod se automaticky objeví na správném místě.

> 📷 *(Místo pro snímek obrazovky: formulář Nový návod s výběrem typu PDF/Odkaz a polem pro štítky)*

### Průvodce aplikací

I Recepci (Předávací protokol, Walkiny i Taxi) pokrývá úvodní **Prohlídka aplikace** — interaktivní průvodce, který se spustí automaticky při prvním přihlášení a je kdykoli znovu dostupný tlačítkem **„? Nápověda"** vlevo dole. Zobrazuje jen kroky odpovídající vašim oprávněním, takže uvidíte pouze ty části Recepce, ke kterým máte přístup.

> 💡 Na stránce **Nápověda** je i seznam všech kroků prohlídky. Kliknutím na kterýkoli krok v seznamu se prohlídka spustí rovnou od něj — aplikace sama přejde na odpovídající místo a příslušný prvek zvýrazní, takže se k dané části nemusíte proklikávat od začátku.

### Verze aplikace a přehled změn

Vlevo dole (na mobilu v nabídce **„Více"**) se zobrazuje aktuální **verze aplikace** (např. `v4.2.4`) — jen uživatelům s oprávněním **„Zobrazit verzi aplikace"**. Na počítači platí: máte-li navíc oprávnění **„Zobrazit změny verzí"**, je verze **klikací** a po kliknutí se otevře okno se **seznamem změn** v jednotlivých verzích. Bez tohoto oprávnění (a na mobilu) se verze zobrazí jen jako text.

> 📝 Na mobilu se panel **„Více"** dá zavřít i klepnutím kamkoli mimo něj – nemusíte už mířit přesně na tlačítko **✕**. Oddělovací čára nad položkou **„Odhlásit"** je nyní zřetelně vidět i v tmavém režimu.

## Developer documentation

Architecture, data model, per-feature implementation notes, and deployment are in **[DOCUMENTATION.md](DOCUMENTATION.md)** (which indexes the topic files under `docs/`).

## Repository layout

```
frontend/    React + TypeScript app (Vite)
functions/   Firebase Cloud Functions (Express API)
docs/        Developer documentation (indexed by DOCUMENTATION.md)
manuals/     Czech per-role user manuals
```
