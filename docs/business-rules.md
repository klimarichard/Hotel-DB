# Provozní pravidla aplikace

Tento soubor sbírá **netriviální pravidla chování aplikace** – číselné limity, podmínky, co se stane po schválení, co se přenáší dál, co je nevratné a co aplikace jen doporučuje. Tedy věci, které **uživatel nemůže odvodit z rozhraní** tím, že se na ně podívá.

Je to jediný obsah tohoto souboru. Popisy obrazovek, návody „klikněte sem" ani technická implementace sem nepatří – ty jsou v `README.md` (uživatelská část), v průvodci aplikací (`frontend/src/lib/tours/appTour.ts`, který zároveň plní stránku Nápověda) a ve vývojářské dokumentaci (`DOCUMENTATION.md` + ostatní soubory v `docs/`).

O tom, zda se obsah někde zobrazí uživatelům, zatím není rozhodnuto.

## Jak soubor udržovat

1. **Každé pravidlo musí mít odkaz na zdroj v kódu** (`> Zdroj: cesta:řádky`). Bez odkazu se nedá ověřit a začne tiše zastarávat.
2. **Před úpravou pravidla ověřte kód, ne tento text.** Zdrojem pravdy je kód; tento soubor je jeho popis.
3. **Rozlišujte úroveň vynucení** (viz značky níže). Formulace typu „aplikace to nedovolí" je u pravidla vynuceného jen v prohlížeči nepravdivá.
4. Změníte-li chování popsané níže, upravte pravidlo ve stejném commitu.

> ⚠️ Tento soubor vznikl 2026-07-20 při vyřazení složky `manuals/`. Při jeho sestavování se ukázalo, že **dvě tehdy dokumentovaná pravidla už roky neplatila** (viz „Vyřazená pravidla" na konci). Proto ten důraz na odkazy do kódu.

**Značky úrovně vynucení:**

| Značka | Význam |
|---|---|
| 🔒 **Server** | Vynuceno na serveru. Nelze obejít ani přímým voláním API. |
| 🖥️ **Jen rozhraní** | Kontrola běží pouze v prohlížeči. Jde o upozornění, ne o záruku. |
| ⚙️ **Automatika** | Aplikace to udělá sama, bez zásahu uživatele. |

---

## Zaměstnanci a pracovní poměr

### Datum nástupu je začátek souvislého poměru, ne poslední smlouvy

Sloupec **Datum nástupu** v seznamu zaměstnanců neukazuje začátek aktuální smlouvy, ale začátek **souvislého** pracovního poměru. Navazující smlouvy se spojují do jednoho úseku.

Za souvislé se považuje i přerušení dlouhé **nejvýše jeden kalendářní měsíc**. Nelze-li návaznost určit (chybí datum, nebo předchozí úsek nemá konec), bere se úsek jako souvislý.

*Příklad:* zaměstnanec nastoupil v listopadu 2022, smlouva skončila 31. 12. 2023 a od 1. 1. 2024 běží nová – sloupec zobrazí **listopad 2022**.

> 🔒 Server. Zdroj: `functions/src/routes/employees.ts:421-478`, hranice tolerance na `:470`.

### Souběžné smlouvy: rozhoduje naposledy zahájená

Má-li zaměstnanec více aktivních smluv zároveň (typicky hlavní poměr a k němu DPP), **mzdy i směny se přiřadí k naposledy zahájené aktivní smlouvě**. Po jejím ukončení se výpočet vrací k hlavní smlouvě.

Smlouva se počítá jako zahájená až v den svého začátku – budoucí smlouva nezíská přednost předem. Není-li aktivní žádná, aplikace zobrazí nejbližší budoucí.

> 🔒 Server. Zdroj: `functions/src/routes/employees.ts:219-236`; hranice „zahájené" na `:225`, budoucí úsek na `:230-235`.

### Ukončení poměru automaticky uzavře Multisport, ale extranet je nutné vyřídit ručně

Při ukončení pracovního poměru aplikace **sama uzavře Multisport** – běžícím obdobím i doprovodným kartám nastaví konec na **konec měsíce ukončení**. Období, která by začínala až po tomto měsíci, se zruší úplně.

**Tím ale platba u Multisportu nekončí.** Kartu je nutné zrušit i v **extranetu Multisport**, což je mimo tuto aplikaci a aplikace to nijak nehlídá. Po ukončení poměru se proto zobrazí připomínka „Zrušit Multisport v extranetu".

> ⚙️ Automatika + 🔒 Server. Zdroj: `functions/src/routes/employees.ts:1522-1541` (volané z `:1649`); připomínka `frontend/src/pages/EmployeeDetailPage.tsx:1940-1948`.

### Kontrola minimální mzdy jen upozorňuje, nikdy neblokuje

Zadáte-li mzdu pod minimální, aplikace zobrazí upozornění zakončené dotazem **„Přesto uložit?"** – uložení je vždy možné.

Rozsah kontroly se liší podle typu smlouvy:

- **HPP** – porovnává se s plnou minimální mzdou.
- **PPP** – poměrnou částí podle týdenního úvazku (`minimální mzda / 40 × hodiny týdně`).
- **DPP** – **nekontroluje se vůbec.**

> 🖥️ Jen rozhraní. Kontrola žije pouze v prohlížeči (`frontend/src/lib/minWage.ts:24-36`, dialog `frontend/src/pages/EmployeeDetailPage.tsx:825-871`); na serveru žádná obdoba není. Nejde tedy o záruku, že mzda pod minimem v datech nevznikne.

---

## Směny

### Limity vlastního volna (X) podle typu smlouvy

Počet vlastních X, které si zaměstnanec může zadat za měsíc:

| Typ smlouvy | Limit za měsíc |
|---|---|
| HPP (plný úvazek) | 8 |
| PPP (poloviční úvazek) | 13 |
| DPP | neomezeně |

Při překročení limitu se otevře **žádost o výjimku** s odůvodněním, kterou administrátor schválí nebo zamítne.

**Dny dovolené se do limitu nezapočítávají.** X zapsané schválenou dovolenou je vedeno zvlášť a limit nesnižuje.

> 🔒 Server, ale **pouze pro samoobslužné zadání**. Držitelé oprávnění `shifts.xAllowance.manage` a administrátoři pravidlo obcházejí na serveru i v rozhraní, takže pro ně limit neplatí. Zdroj: `functions/src/routes/shifts.ts:1190-1196` (limity), `:1325-1336` (výjimka), `:1312-1317` (dovolená mimo limit), rozsah vynucení `:1268`.

### Nejvýše 6 X v řadě – bez možnosti výjimky

Zapsat **více než 6 X po sobě jdoucích dnů** aplikace odmítne úplně. Na rozdíl od měsíčního limitu zde **není cesta přes žádost o výjimku** – delší volno se řeší dovolenou.

Do řady se počítají jen **vlastní** X. Schválená dovolená zapíše X se svým vlastním původem, takže ani čtrnáctidenní dovolená toto pravidlo neporuší.

> 🔒 Server. Zdroj: `functions/src/routes/shifts.ts:1319-1324` (hláška „Nelze zadat více než 6 X po sobě jdoucích dnů…"), rozsah započítávání `:1310-1317`. Kontrola v rozhraní `frontend/src/pages/ShiftPlannerPage.tsx:1204` je jen předběžná.

### Plán směn lze smazat pouze ve stavu „Vytvořený"

Smazání celého měsíčního plánu je možné **jen dokud je plán ve stavu Vytvořený**. V pozdějších stavech server žádost odmítne (chyba 409), i kdyby se tlačítko podařilo zobrazit. Chrání to už vyplněné směny před ztrátou.

> 🔒 Server. Zdroj: `functions/src/routes/shifts.ts:753-776`, kontrola stavu na `:771` (nezávisle na oprávnění `shifts.plan.delete` na `:757`).

### Automatické doplnění „R" při publikaci plánu

Při přechodu plánu do stavu **Publikovaný** aplikace sama doplní kód **R** do prázdných buněk – ale jen za těchto podmínek:

- pouze **pondělí až pátek**,
- pouze zaměstnancům v sekci **Vedoucí** (rozhoduje zařazení do sekce, nikoli pracovní pozice nebo název role),
- pouze do **prázdných** buněk; buňka s jakýmkoli obsahem včetně X zůstane beze změny,
- **státní svátky se přeskakují** (ve svátek náleží náhrada za svátek, ne „R").

> ⚙️ Automatika, 🔒 Server. Zdroj: `functions/src/services/planTransitions.ts:84-146`, volané z `:212`; sekce `:90-97`, obsazenost `:100-106`, dny v týdnu `:113`, svátky `:109,116`.

### Ukazatel u 1. dne měsíce: jak zaměstnanci skončil předchozí měsíc

V plánu ve stavu **Uzavřený** se u prvního dne měsíce zobrazuje u každého řádku malé číslo. Popisuje, jak dotyčnému skončil **předchozí** měsíc:

- **záporné číslo** – do konce měsíce sloužil; číslo udává, kolik dní v řadě odsloužil (**−2** = sloužil poslední dva dny měsíce),
- **kladné číslo** – na konci měsíce nesloužil; číslo udává, kolik dní v řadě před 1. dnem neměl směnu (**2** = poslední dva dny měl volno),
- **N/A** – nelze určit.

Za odslouženou se počítá **jen skutečná směna** – recepce, portýři, zaučení, nebo ručně zadaný počet hodin. **X** (vlastní volno i dovolená), **R** (den vedoucího) a **HO** (home office) se za službu **nepovažují**. U „R" je to podstatné: doplňuje se automaticky až při publikaci plánu (viz pravidlo výše), takže kdyby se počítalo, číslo by se změnilo samo od sebe mezi uzavřením a publikací.

**N/A** znamená, že plán předchozího měsíce neexistuje nebo se nikdy nedostal do stavu Uzavřený, že zaměstnanec v tomto plánu vůbec nebyl (typicky nový nástup), nebo že za celý měsíc neodsloužil ani jednu skutečnou směnu.

U sekce **Vedoucí** se číslo zobrazuje **pouze** v záporném případě, tedy jen když do konce měsíce skutečně sloužili. Ve všech ostatních případech zůstává pole **prázdné** – ne N/A. Kladný údaj by u nich měřil hlavně dny strávené na „R", což o odpočinku nevypovídá.

Ukazatel je pouze informativní: nic neblokuje, do ničeho se nepočítá a v jiných stavech plánu se nezobrazuje vůbec. Vyžaduje oprávnění **Zobrazit tabulku obsazenosti**.

> ⚙️ Automatika (počítá server). Zdroj: `functions/src/routes/shifts.ts:513` (endpoint `GET /shifts/prev-month-gap`), výpočet `prevMonthGap()` na `:492`, definice „skutečné směny" `:479-482`; pravidlo pro Vedoucí `frontend/src/pages/ShiftPlannerPage.tsx:1861`, stav plánu `:385`.

---

## Dovolená

### Kolize s naplánovanou směnou blokuje podání žádosti

Žádost o dovolenou, jejíž termín se překrývá s **již přiřazenou směnou**, server odmítne (chyba 409). Není to upozornění, žádost nevznikne.

Kolizí je jen **přiřazená směna**. Prázdné buňky a dny už označené X kolizi nezpůsobí.

Při **schvalování** je pravidlo měkčí: schvalovatel dostane dialog pro vyřešení kolize a může kolidující směny přepsat na X.

> 🔒 Server. Zdroj: `functions/src/routes/vacation.ts:319-330` (podání), `:407-415` (úprava zaměstnancem), definice kolize `functions/src/routes/shifts.ts:150-158,198`, schvalování `vacation.ts:468,529-539`.

### Úprava schválené žádosti: původní termín platí dál

Upraví-li se **už schválená** žádost o dovolenou, změna se uloží jako **návrh čekající na schválení** a **původní schválený termín zůstává v platnosti**, dokud administrátor úpravu neschválí.

- Schválení úpravy nový termín promítne a přepíše X v plánu.
- Zamítnutí návrh zahodí a původní termín ponechá.
- Souběžně může čekat **jen jedna** úprava.

U dosud neschválené žádosti se termín mění rovnou.

> 🔒 Server. Zdroj: `functions/src/routes/vacation.ts:417-437` (uložení návrhu), `:481-513` (schválení), `:514-521` (zamítnutí), `:388-391` (jen jedna úprava).

### Schválení dovolené zapisuje X do plánu směn

Po schválení žádosti aplikace **sama zapíše X** do všech dotčených měsíčních plánů. Tato X mají vlastní původ, takže se nezapočítávají do limitu vlastního volna.

Zápis se **tiše přeskočí**, pokud daný měsíční plán ještě neexistuje, nebo pokud v něm zaměstnanec není zařazen. Vznikne-li plán až později, dovolená se do něj zpětně nedoplní.

> ⚙️ Automatika, 🔒 Server. Zdroj: `functions/src/routes/vacation.ts:549-555` → `functions/src/routes/shifts.ts:281-314` a `:222-274`; podmínky přeskočení `:302,310`.

### Schválení volné směny zamítne konkurenční žádosti

Přidělí-li administrátor volnou směnu jednomu zaměstnanci, všechny **ostatní čekající žádosti o tutéž směnu** se automaticky zamítnou s odůvodněním „Směnu převzal jiný zaměstnanec." Každé zamítnutí se zapíše do Logu změn.

> ⚙️ Automatika, 🔒 Server. Zdroj: `functions/src/routes/shifts.ts:2392-2408`, audit `:2413-2423`.

### Schválené žádosti o změnu se promítnou samy – kromě dvou případů

Schválení žádosti o změnu směny se do plánu **zapíše automaticky** u typů *Typ směny*, *Zadat počet hodin*, *Smazat* a *Vyměnit s*.

Ručně musí administrátor upravit plán ve dvou případech:

1. typ **„Jiné"** (volný text) – aplikace neví, co zapsat,
2. **starší žádosti**, které obsahují jen odůvodnění bez strukturovaného požadavku (vznikly před zavedením strukturovaných žádostí).

> 🔒 Server. Zdroj: `functions/src/routes/shifts.ts:2431-2497`; „Jiné" na `:2497`, starší žádosti `:2429-2431`.

---

## Mzdy

### Přepočítání vs. tvrdý přepočet

- **Přepočítat** – ruční úpravy ve mzdách **zůstanou zachovány**.
- **Tvrdý přepočet** – ruční úpravy **zahodí** a vše dopočítá znovu z plánu směn. **Nemoc a poznámky ale zůstávají** i po tvrdém přepočtu.

> 🔒 Server. Zdroj: `functions/src/routes/payroll.ts:993-1025` (přepočet), `:1032-1063` (tvrdý přepočet), zachovaná pole `:1029-1030`.

### Uzamčení období je nevratné a zároveň plní evidenci dovolené

Uzamčení mzdového období má **dva důsledky**, z nichž druhý není z rozhraní vidět:

1. Období **nelze smazat, přepočítat ani v něm nic upravit** – server všechny takové pokusy odmítne (chyba 409).
2. Uzamčení je **jediný okamžik, kdy se plní hodinová evidence dovolené**. Bez uzamčení období zůstanou hodnoty v evidenci nedoplněné.

> 🔒 Server. Zdroj: `functions/src/routes/payroll.ts:1005-1008` (přepočet), `:1044-1047` (tvrdý přepočet), `:1085` (smazání), `:52-65` (úpravy); plnění evidence `:758-790`.

### Poloviční úvazek: dovolená poměrně, ale přesčas až od plné základny

U PPP určuje **týdenní úvazek** výši nároku na dovolenou – ta se počítá **poměrně** k úvazku.

**Na přesčas (Navíc) se ale poměr nevztahuje.** Zaměstnanec na částečný úvazek může odpracovat až **plnou měsíční základnu** (jako HPP), než se jakákoli hodina začne počítat jako Navíc. Zaměstnanec s úvazkem 20 h/týden tedy dovolenou kumuluje poloviční rychlostí, ale Navíc mu vzniká až po překročení plné základny.

> 🔒 Server. Zdroj: `functions/src/services/payrollCalculator.ts:274-278` a `:596` (dovolená poměrně), `:594-595` (Navíc od plné základny); komentáře v kódu `:270-272,590-593`.

---

## Tabulky – Směnárna + ČNB

### Stránka se vždy otevře prázdná; uchová se jen to, co uložíte

Směnárna se **nikdy neukládá sama**. Otevře se vždy prázdná se čtyřmi výchozími řádky a rozepsaný výpočet je po obnovení stránky pryč. Chcete-li si výpočet nechat, uložte ho tlačítkem **Uložit**.

Uloží se **celý stav tabulky** – řádky i jejich názvy, obě tabulky bankovek, částky v měnách, oba kurzy i řádek směnárna. Ze seznamu v sekci **Historie** se pak dá kdykoli **načíst zpět**.

**Načtení uložených dat přepíše vše, co máte právě rozepsané, a nelze ho vrátit zpět.** Máte-li něco vyplněné, aplikace se před načtením zeptá.

> ⚙️ Automatika + 🔒 Server. Zdroj: `frontend/src/pages/tabulky/SmenarnaTab.tsx` – `saveSnapshot()`, `applySnapshot()`; `functions/src/routes/exchange.ts` – `/snapshots`.

### Uložená data jsou společná a mažou se po 6 měsících

Uložená data **nejsou soukromá**: každý, kdo má oprávnění Směnárna + ČNB, vidí v Historii záznamy všech ostatních a může je také **smazat**. U každého záznamu je vidět datum, čas a jméno toho, kdo ho uložil.

Záznamy starší než **6 měsíců** aplikace **sama maže** (denní úloha). Nejde o účetní doklad – nic jiného se na uložená data neodkazuje a jejich smazáním nezmizí žádná provozní data.

> ⚙️ Automatika + 🔒 Server. Zdroj: `functions/src/services/smenarnaRetention.ts` (hranice 6 měsíců na `RETENTION_MONTHS`), plánovaná úloha `sweepSmenarnaSnapshots` v `functions/src/index.ts`.

### Do Recepce se z této tabulky nikdy nic nezapíše

Jediná vazba na Recepci je **čtení** tří kurzů z řádku „sm", kterými se předvyplní řádek **kurz u nás**. Kurz zde můžete přepsat, ale změna platí jen pro tento výpočet – **do Recepce se nikdy nic nezapíše**, a naopak úprava v Recepci nemůže změnit nic v této tabulce ani v uložených datech.

> 🔒 Server. Zdroj: `functions/src/routes/exchange.ts` – kurzy jsou dostupné jen přes `GET /exchange/rates`, žádná zapisovací cesta neexistuje.

### Bankovky 5000 se použijí jen do počtu, který už máte

V tabulce **Ideální složení** se rozkládá každá částka na bankovky a mince od největší po nejmenší. **Bankovky 5000 jsou ale omezené**: použije se jich nejvýše tolik, kolik jich zadáte v řádku **směnárna** (tedy kolik jich skutečně máte). Nezadáte-li žádnou, tabulka si o 5000 nikdy neřekne a chová se jako původní excelová verze.

Je-li 5000 méně než by se jich vešlo, dostanou je **největší částky jako první**. Není to kvůli počtu bankovek – ten se ušetří stejně, ať 5000 padne kamkoli – ale proto, že malé částky (typicky rozdíly v řádu stokorun) do sebe 5000 nevejdou vůbec, a při postupu shora dolů by tak zbytečně zůstaly nevyužité.

> ⚙️ Automatika. Zdroj: `frontend/src/lib/denominations.ts` – `decompose()` (strop na 5000) a `decomposeAll()` (rozdělení od největší částky).

### Upozornění se objeví jen při nedostatku peněz, ne při jiném složení

Řádky **směnárna** (co jste dostali) a **potřebuji** (co je potřeba na všechny hromádky) se porovnávají **jen v celkové částce**. Rozdíl v jednotlivých nominálech není chyba – větší bankovku lze rozměnit. Upozornění se proto objeví pouze tehdy, když je ze směnárny **celkem méně peněz**, než je potřeba.

> 🖥️ Jen rozhraní. Zdroj: `frontend/src/pages/tabulky/SmenarnaTab.tsx` – proměnná `shortfall`.

### Chybějící kurz vadí jen u měny, kterou jste zadali

Nemít vyplněný kurz je běžné – ne v každé směně se mění všechny měny. Upozornění se proto objeví **jen když je u dané měny zadaná částka a zároveň chybí kurz**. V takovém případě by se měna počítala jako nula a rozdíl (marže) by vyšel vyšší, než ve skutečnosti je.

> 🖥️ Jen rozhraní. Zdroj: `frontend/src/pages/tabulky/SmenarnaTab.tsx` – proměnná `missingRates`.

### Výměna bankovek nemusí sedět sama o sobě – dorovnává ji směnárna

Částka v PŘEDKLÁDÁM se **nemusí** rovnat částce v POŽADUJI. Chybějící část dorovnají koruny získané ve směnárně. Ve sloupci **ze směnárny** v tabulce PŘEDKLÁDÁM se u každého řádku ukáže, kolik z POŽADUJI předložené bankovky nepokryjí.

Kolik ze směnárny zbude, ukazuje sloupec **zbývá ze směnárny**:

> zbývá ze směnárny = CELKEM směnárna − (POŽADUJI − PŘEDKLÁDÁM)

Předložíte-li naopak víc, než požadujete, přebytek se ke směnárně **přičte** (rozdíl je záporný).

**Červeně se řádek označí jen tehdy, když je „zbývá ze směnárny" záporné** – tedy když ani předložené bankovky, ani peníze ze směnárny nestačí na to, co požadujete. Nerovnost sama o sobě chyba není. Kontrola probíhá u každého řádku zvlášť i za celek.

**Sloupec CELKEM směnárna zůstává nedotčený** (hrubý výnos ze směnárny), aby řádek dál dával smysl: CELKEM směnárna − CELKEM u nás = ROZDÍL. Dorovnání se promítá pouze do sloupce „zbývá ze směnárny".

> 🖥️ Jen rozhraní. Zdroj: `frontend/src/pages/tabulky/SmenarnaTab.tsx` – `gap`, `fromExchange`, `zbyva`, `rowsShort`. Odpovídá sloupci H původního sešitu (`=F−(POŽADUJI−PŘEDKLÁDÁM)`).

### Změny nominálů: co vrátit a co si vyžádat

Vedle tabulky složení je seznam **Změny nominálů** – rozdíl mezi tím, co směnárna dala, a tím, co je potřeba. **Kladné číslo** znamená vyžádat si tolik kusů navíc, **záporné** tolik kusů vrátit. Seznam je vždy nejkratší možný: obě strany jsou dané, takže rozdíl u každého nominálu je jediná možná odpověď, není co optimalizovat.

> ⚙️ Automatika. Zdroj: `frontend/src/pages/tabulky/SmenarnaTab.tsx` – `denomChanges`.

### Stránka Tabulky se na telefonu nezobrazuje

Tabulky jsou široké a na telefonu se nedají rozumně vyplňovat, proto se položka **Tabulky** ve spodní liště mobilu **vůbec nenabízí** (stejně jako Šablony smluv). Otevřete-li adresu přímo, stránka se zobrazí, ale počítá se s prací na počítači.

> 🖥️ Jen rozhraní. Zdroj: `frontend/src/lib/menuItems.ts` – `hideOnMobile: true`.

---

## Dokumenty

### Kdo dokument uvidí, určuje jeho sekce

Dokument **bez sekce** vidí každý, kdo má přístup do Dokumentů. Dokument **zařazený do sekce** (Ambiance, Superior, Amigo & Alqush, Ankora, TEMP) vidí jen ten, kdo má oprávnění pro tuto sekci – ostatním se v seznamu vůbec nezobrazí a nelze jej otevřít ani přímým odkazem. Sekce tedy okruh lidí vždy **zužuje, nikdy nerozšiřuje**.

Kdo má oprávnění **Spravovat dokumenty**, vidí všechny sekce – jinak by nemohl opravit ani smazat to, co je v nich zařazené.

**Zařazení dokumentu do sekce (nebo jeho vyřazení) je změna toho, kdo ho uvidí**, ne jen štítek. Přesunutím dokumentu do sekce ho skryjete všem, kdo na ni nemají oprávnění; vyjmutím ze sekce ho naopak zpřístupníte všem, kdo mají přístup do Dokumentů.

> 🔒 Server. Zdroj: `functions/src/services/documentSections.ts` – `maySeeDocumentSection()`; `functions/src/routes/dokumenty.ts` – filtr seznamu a kontrola v `GET /:id`.

### Výchozí sekce mění jen pořadí, nikdy přístup

Volba **Výchozí sekce** je osobní nastavení každého uživatele: dokumenty ze zvolené sekce se zobrazí na začátku seznamu, zbytek za oddělovačem. **Nezpřístupní ani neskryje žádný dokument** – seznam filtruje server podle oprávnění bez ohledu na toto nastavení.

> 🔒 Server. Zdroj: `functions/src/routes/auth.ts` – `PUT /me/dokumenty-default`; pořadí se skládá v `frontend/src/pages/DokumentyPage.tsx`.

### Vytištěné dokumenty se nikde neukládají

Vyplněním a vytištěním dokumentu **nevzniká žádný záznam**. Hotové PDF se pouze otevře na nové záložce – neukládá se do aplikace, nepřipojuje se k žádnému zaměstnanci a nikde ho později nedohledáte. Ukládá se výhradně **šablona** dokumentu.

Z toho plyne i to, že **smazání dokumentu je nevratné**, ale týká se jen šablony – už vytištěné papíry tím nijak nezmizí a nic se na ně neváže.

> 🔒 Server. Zdroj: `functions/src/routes/dokumenty.ts` – `POST /render-pdf` pouze vykresluje a vrací PDF, žádný zápis do databáze ani úložiště.

### Proměnná typu „Seznam" pojme nejvýše 30 hodnot

U vlastní proměnné typu **Seznam** zadáte hodnoty, ze kterých se pak při vyplňování vybírá. Hodnot může být nejvýše **30** a každá nejvýše **100 znaků**.

Seznam **bez jediné hodnoty** je povolený (typ si zvolíte dřív, než hodnoty vypíšete), ale v takovém případě se při vyplňování místo nabídky zobrazí **obyčejné textové pole**, aby dokument šlo i tak vytisknout. Editor na to upozorňuje hláškou „Bez možností".

> 🔒 Server + 🖥️ Jen rozhraní. Zdroj: `functions/src/routes/dokumenty.ts` a `functions/src/routes/contractTemplates.ts` – `isValidCustomOptions()`; upozornění `customVarWarning()` ve `frontend/src/pages/DokumentyPage.tsx`.

### Vlastních proměnných je v dokumentu 25, ve šabloně smlouvy 10

Dokument pojme až **25** vlastních proměnných (`{{var1}}`…`{{var25}}`). Šablona smlouvy jich pojme jen **10** (`{{var1}}`…`{{var10}}`) – jde o podepisovaný právní dokument, kde tolik proměnných není potřeba.

Napíšete-li do šablony smlouvy proměnnou nad tímto rozsahem (např. `{{var15}}`), editor ji sice rozpozná a upozorní na ni („Mimo rozsah"), ale nedovolí jí nastavit název ani typ – při vyplňování se zobrazí jako nepojmenované textové pole. Uložit definici pro takovou proměnnou nelze ani obejitím rozhraní – server ji odmítne.

> 🔒 Server. Zdroj: `functions/src/routes/dokumenty.ts` (`CUSTOM_VAR_KEYS`, 25 položek) a `functions/src/routes/contractTemplates.ts` (`CUSTOM_VAR_KEYS`, 10 položek) – obojí uvnitř `isValidVariableDefs()`; upozornění na šabloně smlouvy `customVarWarning()` ve `frontend/src/pages/ContractTemplatesPage.tsx`.

### Přepínač „podle hodnoty" (např. různý obrázek podle města) má reálný strop 1 MB na celý dokument

Přepínač `{{#case}}` umí pro každou hodnotu proměnné vytisknout jiný text – včetně jiného obrázku. Pro obrázky ale neplatí žádný zvláštní limit počtu ani velikosti; platí jen limit **na celý dokument/šablonu jako celek** – Firestore nedovolí uložit dokument větší než **1 MB**, a obrázky vložené přímo do textu (base64) se do tohoto součtu počítají celé. Přepínač s obrázkem pro každé z několika měst proto dosáhne tohoto stropu dávno předtím, než by došel počet povolených větví (30 hodnot u proměnné typu Seznam).

Uložení dokumentu/šablony, které by tento limit překročilo, aplikace odmítne rovnou s vysvětlující hláškou – neuloží se ani zbytek změn.

> 🔒 Server. Zdroj: `functions/src/routes/dokumenty.ts` a `functions/src/routes/contractTemplates.ts` – kontrola velikosti `htmlContent` (1 048 576 B) před i při zápisu do `PUT /:id`.

## Faktury

### Faktura zde je koncept, ne účetní doklad – smazání je tiché a nevratné

Faktura vytvořená na této stránce je **vizuální kopie** dokladu, který vystavil Protel – tato aplikace fakturu nevystavuje ani nečísluje. Uložená faktura se proto chová jinak než většina ostatních dat v aplikaci: smazání **nezanechává žádnou stopu v Logu změn** a je **nevratné** (žádný koš, žádná záloha). Skutečný doklad v Protelu tím není nijak dotčen – maže se jen tato kopie.

> 🔒 Server. Zdroj: `functions/src/routes/faktury.ts` – `DELETE /:id` (`:664-678`) a `POST/PUT` konceptu (`:572-599`, `:616-657`) neobsahují žádné volání auditního logu, na rozdíl od `PUT /config`, které auditované je (`:393-450`).

### Sazba DPH v bloku „Záloha" se v rekapitulaci vykazuje zvlášť

Česká pravidla vyžadují, aby přijatá **záloha** byla v rekapitulaci DPH vykázána zvlášť od běžného plnění, které pak zúčtovává. Sazba DPH v číselníku proto nese kromě procenta i **blok** (Běžná / Záloha); dvě sazby se stejným procentem (např. 12 % běžná a 12 % záloha) se **nikdy nesčítají do jednoho řádku** v rekapitulaci se vykazují jako samostatné řádky a poznají se **jen podle názvu sazby** (např. „Deposit 12.00 %"), přesně jako na původním dokladu z Excelu – žádný oddělovací nadpis tam není.

**Přeřazení sazby do špatného bloku v číselníku Faktur není vidět nikde jinde než v rekapitulaci vytištěné faktury** – smísí zálohu s běžným plněním tiše, bez upozornění.

> 🔒 Server + ⚙️ Automatika. Zdroj: `functions/src/services/invoiceTypes.ts` – blok jako součást sazby (`VatBlock`) a `computeTotals()` (řádky se sčítají podle `vatRateId`, blok se nese dál); vykreslení rekapitulace `functions/src/services/invoiceHtml.ts` (`recapBlock`). Stejná pravidla platí i pro živý náhled v prohlížeči, `frontend/src/lib/faktury.ts`.

### „Aktivní" a „Zobrazit při tisku" u sazby DPH nejsou totéž

U sazby DPH v Číselnících rozhodují **dvě nezávislá zaškrtávátka**:

- **Aktivní** – sazbu lze vybrat na řádku faktury. Neaktivní sazba se v nabídce vůbec neobjeví.
- **Zobrazit při tisku** – sazba se objeví v rekapitulaci DPH i tehdy, když je neaktivní a nulová (vytiskne se s `0,00`).

Historické sazby 10 % a 15 % (a jejich zálohové protějšky) mají být **neaktivní, ale tištěné**: nikdo je už nesmí použít, původní doklad z Protelu je však vypisuje. Sazba, na kterou odkazuje některá uložená faktura, se v rekapitulaci objeví vždy, i bez obou zaškrtávátek – zrušením sazby tak nikdy tiše nezmizí peníze z již vystavené faktury.

**Zaškrtnutí „Zobrazit při tisku" mění vzhled všech tištěných faktur** – i těch dávno uložených, protože rekapitulace se počítá při tisku, neukládá se.

> 🔒 Server + ⚙️ Automatika. Zdroj: `functions/src/services/invoiceTypes.ts` – `VatRate.showInPrint` a podmínka v `computeTotals()` (`!rate.active && !rate.showInPrint && gross === 0` → řádek se vynechá); zrcadleno v `frontend/src/lib/faktury.ts`. Nová konfigurace příznak nedostane automaticky – `sanitizeConfig()` ho čte jako `showInPrint === true`.

## Recepce – Odvody

### Odvody se připravují z Předávacího protokolu, ne ze samostatné záložky

Odvod se zadává tlačítkem **„Připravit odvod"** v sekci **Účty** předávacího protokolu, vedle tlačítka „+ Přidat účet". Tlačítko vidí jen držitelé oprávnění **„Připravit odvod"** (`recepce.<hotel>.odvody.manage`), které je v matici zařazeno **pod Předávacím protokolem**, na stejné úrovni jako „Spravovat protokol". Samostatné oprávnění pro pouhé prohlížení odvodů neexistuje – kdo odvod vidí, ten ho i zadává.

Tlačítko se nezobrazí na **podepsaném** protokolu; podpis je nutné nejdřív zrušit.

> 🔒 Server. Zdroj: `functions/src/routes/odvody.ts` (`requireOdvodyManage`), zařazení v matici `frontend/src/lib/permissions/catalog.ts` (odvody.manage jako level 3 pod `protokol.view`).

### Uložení odvodu okamžitě přepíše protokol, ale peníze ještě neodejdou

Uložením odvodu se v **předávacím protokolu aktuální směny** stane trojí:

1. odečtou se spočítané **bankovky CZK** – přednostně z **trezoru**, a nestačí-li v něm daný nominál, zbytek se automaticky vezme z **kasy**,
2. **zaškrtnuté účty** se z protokolu smažou (jsou už zavedené v účetnictví),
3. místo nich přibude jeden **zamčený řádek „odvod + účty"** v hodnotě `bankovky CZK + zaškrtnuté účty`.

Celkový součet CZK v protokolu se tím **nezmění** – peníze se jen přesunou z bankovek a papírových účtů do jedné položky. Fyzicky jsou pořád v hotelu.

**Bankovky EUR zůstávají na místě** a v protokolu se nemění vůbec nic. Odečtou se až při provedení odvodu (viz níže) – a to ze stejných zásuvek, ze kterých byly při přípravě odvodu vyhrazeny.

Protože nový protokol přebírá hotovost i účty z předchozí směny, zamčený řádek i snížený trezor se dál nesou celým řetězcem směn samy.

> 🔒 Server + ⚙️ Automatika. Zdroj: `functions/src/routes/odvody.ts:214` (`applyEffect`), zápis do protokolu v `PUT /:hotel/:month` na `:578`.

### Odvod se vždy zapíše do protokolu právě probíhající směny

Cílem není protokol, který si uživatel vybere, ale **protokol směny, která běží v okamžiku uložení** (denní 07:00–18:59, jinak noční). Neexistuje-li ještě, aplikace ho založí a přenese do něj zůstatky z předchozí směny – ale **jen tehdy, je-li předchozí směna podepsaná oběma podpisy, nebo neexistuje**. Jinak uložení odmítne s vysvětlením: rozepsaná směna by se předčasně „zmrazila" a recepční by pak tlačítkem „další směna" otevřel tuto zastaralou kopii místo svých konečných čísel.

> 🔒 Server. Zdroj: `functions/src/routes/odvody.ts:324` (`resolveTarget`), podmínka blokace na `:334-341`.

### Odvod smí přepsat i podepsaný protokol

Běžnou úpravu podepsaného protokolu server odmítá. **Uložení odvodu je výjimka** – jde o privilegovanou měsíční operaci, kterou provádí držitel práva `recepce.<hotel>.odvody.manage`. Přepis se zaznamená do protokolu změn s příznakem `overrodeSignature`, takže je dohledatelný.

> 🔒 Server. Zdroj: `functions/src/routes/odvody.ts:578` (`PUT`), příznak v auditu na `:727`.

### Chybí-li nominál v trezoru, dobere se z kasy – ale jen do jejich součtu

Bankovky se berou **nejdřív z trezoru**; co v něm daný nominál nepokryje, doplní se **z kasy**. V modálu jsou proto oba stavy vidět ve dvou sloupcích (TREZOR a KASA) a u řádku, který sáhl do kasy, je to výslovně napsané.

Nestačí-li ani součet obou, uložení se **odmítne** – s uvedením, kolik kusů je v trezoru a kolik v kase. Odvod se nikdy neuloží částečně: menší počet bankovek, než kolik si člověk odpočítal do ruky, by rozešel doklad se skutečností.

Aplikace si pamatuje, **ze které zásuvky který kus pochází**, takže vrácení odvodu vrátí bankovky přesně tam, odkud byly vzaty. U eur se dostupnost kontroluje **znovu při provedení odvodu**, protože směny mezitím mohly bankovky utratit.

> 🔒 Server. Zdroj: `functions/src/services/odvodyShared.ts` (`allocateFromDrawers`), použití v `functions/src/routes/odvody.ts` (`applyEffect`), opakovaná kontrola EUR v `POST /:hotel/settle-eur`.

### Odvod je upravitelný, ale oprava se dělá vrácením, ne přepočtem

Uložený odvod lze kdykoli přepsat nebo smazat. Aplikace k tomu **nepočítá rozdíl** proti protokolu – u každého odvodu má uloženo, co přesně provedl (které bankovky, celé znění smazaných účtů, id vytvořeného řádku), a při úpravě to nejdřív celé **vrátí zpět** a teprve pak zapíše nový stav.

Vrácení je záměrně přísné: **není-li v protokolu zamčený řádek „odvod + účty", operace se odmítne**. Aplikace v takové situaci bankovky do trezoru nepřipíše, protože by dopisovala peníze do stavu, za který nikdo neručí. Protokol je pak nutné srovnat ručně.

> 🔒 Server. Zdroj: `functions/src/routes/odvody.ts:179` (`reverseEffect`), uložený zásah `OdvodEffect` v `functions/src/services/odvodyShared.ts`.

### Změny odvodu se nezapisují do historie protokolu a nejdou vzít zpět

Zásah odvodu do protokolu **neprochází historií změn ani funkcí Zpět/Znovu** – stejně jako převody sm a wata. Zásah se totiž týká dvou dokumentů zároveň; kdyby šlo vzít zpět samotné snížení trezoru, záznam odvodu by dál tvrdil, že peníze odešly. Změny se místo toho zapisují do protokolu změn (auditu).

> 🔒 Server. Zdroj: `functions/src/routes/odvody.ts` – hlavičkový komentář; obdobné pravidlo `functions/src/services/handoverHistory.ts`.

### Provedený odvod je nevratný

Tlačítko **„Provést odvod"** se objeví u zamčeného řádku pouze na **poslední noční směně v měsíci** (noční směna je vedená pod dnem, kdy začíná – poslední noční červencová směna je tedy 31. 7., i když končí 1. 8.). Potvrzením se zamčený řádek z Účtů smaže a odečtou se **bankovky EUR** – z trezoru a z kasy přesně v tom rozdělení, ve kterém byly při přípravě odvodu vyhrazeny. Teprve tím peníze z protokolu skutečně odejdou a celkové součty klesnou.

Provedený odvod **už nelze upravit ani smazat** – peníze fyzicky odešly. Případnou opravu je nutné udělat přímo v protokolu.

Tlačítko smí stisknout kterýkoli recepční s právem upravovat protokol; právo `odvody.manage` k tomu potřeba není. Na podepsaném protokolu tlačítko nefunguje – podpis je nutné nejdřív zrušit.

> 🔒 Server. Zdroj: `functions/src/routes/odvody.ts:433` (`POST /:hotel/settle-eur`), podmínka poslední noční směny `isLastNightOfMonth()` v `functions/src/services/odvodyShared.ts`; blokace úprav v `PUT` na `:615-620` a v `DELETE` na `:762-765`.

### Depozity se odvádějí vždy celé, zbytek jde z hotovosti

Ze čtyř hodnot opsaných z Protelu se **oba depozity odvádějí v plné výši**, bez ohledu na to, kolik se odvádí celkem. Teprve zbytek (`celkem k odvodu − depozity`) se bere z položky *cash*.

Je-li depozitů víc, než kolik se má odvést, aplikace na to **upozorní, ale uložení nezablokuje** – hodnoty z Protelu zadává člověk a může vědět víc.

> 🔒 Server (výpočet) + 🖥️ Jen rozhraní (upozornění). Zdroj: `functions/src/services/odvodyShared.ts:155` (`computeCurrencyPlan`), zrcadleno v `frontend/src/lib/odvody.ts`.

### Amigo & Alqush: poměr se vztahuje na zůstatek, ne na odvedenou částku

Amigo a Alqush mají **společnou hotovost, ale oddělené registry v Protelu**, proto se u nich zadává osm hodnot místo čtyř. Depozity se i zde odvádějí celé; zbytek se mezi oba hotely rozdělí tak, aby **zůstatky v pokladnách po odvodu** byly v zadaném poměru – tedy ne tak, aby v poměru byly odvedené částky.

Poměr odpovídá **počtu pokojů** (výchozí 70 : 24) a je v modálu **editovatelný**, protože se počty pokojů mohou změnit. Zaokrouhlení pohltí poslední hotel v pořadí, takže součet odvedených částek vždy přesně sedí na požadovaný zbytek.

**Všechny částky odvodu jsou celá čísla, a to i v eurech** – v trezoru jsou pouze bankovky (500 až 1 €), žádné centové mince, takže částku s centy by nešlo fyzicky odpočítat. Zadáte-li do hodnot z Protelu desetinné číslo, aplikace ho zaokrouhlí na celé.

*Příklad:* celkem k odvodu 150 000 Kč; Amigo cash 180 000 / depozit 20 000, Alqush cash 60 000 / depozit 5 000. Depozity 25 000 odejdou celé, z hotovosti se bere 125 000. V pokladnách zůstane 115 000, rozdělených 70 : 24 → Amigo 85 638, Alqush 29 362. Odvede se tedy **Amigo 94 362** a **Alqush 30 638**.

> 🔒 Server. Zdroj: `functions/src/services/odvodyShared.ts:155` (`computeCurrencyPlan`, větev pro víc registrů), výchozí poměr `DEFAULT_SPLIT_WEIGHTS`.

### Za skončený měsíc už odvod nepřipravíte

Otevřete-li **měsíc, který už skončil** a odvod za něj nikdy nevznikl, formulář se vůbec nenabídne – zobrazí se jen hláška **„V tomto měsíci nebyly odvody připraveny."** Odvod je totiž ujednání, že se hotovost odveze do banky **před uzávěrkou daného měsíce**; ta už proběhla a zpětně by se pod hlavičku minulého měsíce jen přesunuly dnešní peníze.

Odvod, který za minulý měsíc **existuje**, se otevře normálně a lze ho opravit i smazat – aby šla napravit chyba.

> 🔒 Server + 🖥️ Rozhraní. Zdroj: `functions/src/routes/odvody.ts` (kontrola v `PUT /:hotel/:month`, `isPastMonth()` z `functions/src/services/odvodyShared.ts`); v rozhraní `frontend/src/pages/recepce/OdvodyModal.tsx` (`pastEmpty`).

### Na hotel a měsíc připadá jeden odvod

Odvod je uložen pod klíčem měsíce (`hotels/<hotel>/odvody/<RRRR-MM>`), takže **druhé uložení tentýž měsíc přepíše to první** (s vrácením předchozího zásahu, viz výše). Rozdělit měsíc na dva odvody nelze.

> 🔒 Server. Zdroj: `functions/src/services/odvodyShared.ts` (`odvodCol`), `functions/src/routes/odvody.ts:578`.

## Vyřazená pravidla

Pravidla, která dřívější dokumentace uváděla, ale která **v současném kódu neplatí**. Ponechána zde, aby se nevrátila zpět.

### ❌ „Odkaz na smazanou vlastní proměnnou tiše smaže celý odstavec ze smlouvy"

**Neplatí.** Šablona odkazující na smazanou proměnnou je zachycena na třech místech: editor zobrazí varování „Bez nastavení: …", generování se **zablokuje** a proměnná se nabídne k vyplnění. Tiché zmizení odstavce nehrozí.

> Zdroj: `frontend/src/lib/contractVariables.ts` – `usedCustomVars()` a `requiredCustomVars()` (:329-367), `missingCustomVars()` (:640-659); varování při uložení `frontend/src/pages/ContractTemplatesPage.tsx:758`; blokace generování `frontend/src/components/GenerateContractModal.tsx:211-212,278`. (Řádková čísla platí ke dni poslední aktualizace tohoto pravidla, 2026-07-24 – engine v souboru od té doby výrazně narostl, viz [custom-variable-engine.md](custom-variable-engine.md).)

**Co platí dál:** nepárové značky `{{#if}}` / `{{/unless}}` se do dokumentu vypíšou jako text. Není to tichá chyba v původním smyslu (jde o záměrné chování šablonovacího jádra a bloky se dnes korektně zanořují), ale kontrola párovosti při ukládání šablony neexistuje.
> Zdroj: `frontend/src/lib/contractVariables.ts` – `parseBlocks()` (:1211-1260, nepárová/chybějící značka jako text na :1236-1241), zanoření přes rekurzi v `renderBlocks()` (:1262-1299).

### ❌ „Týdenní úvazek u PPP určuje i hranici přesčasu"

**Neplatí** – určuje pouze nárok na dovolenou. Skutečné chování viz „Poloviční úvazek: dovolená poměrně, ale přesčas až od plné základny" výše.

### ❌ „Datum nástupu vyžaduje zcela nepřerušenou návaznost smluv"

**Nepřesné** – tolerance je až jeden kalendářní měsíc, ne nula. Viz „Datum nástupu je začátek souvislého poměru" výše.
