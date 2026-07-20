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

### Stránka se vždy otevře prázdná; uchová se jen to, co uložíte jako snímek

Směnárna se **nikdy neukládá sama**. Otevře se vždy prázdná se čtyřmi výchozími řádky a rozepsaný výpočet je po obnovení stránky pryč. Chcete-li si výpočet nechat, uložte ho tlačítkem **Uložit snímek**.

Snímek zachytí **celý stav tabulky** – řádky i jejich názvy, obě tabulky bankovek, částky v měnách, oba kurzy i řádek směnárna. Ze seznamu se pak dá kdykoli **načíst zpět**.

**Načtení snímku přepíše vše, co máte právě rozepsané, a nelze ho vrátit zpět.** Máte-li něco vyplněné, aplikace se před načtením zeptá.

> ⚙️ Automatika + 🔒 Server. Zdroj: `frontend/src/pages/tabulky/SmenarnaTab.tsx` – `saveSnapshot()`, `applySnapshot()`; `functions/src/routes/exchange.ts` – `/snapshots`.

### Snímky jsou společné a mažou se po 6 měsících

Snímky **nejsou soukromé**: každý, kdo má oprávnění Směnárna + ČNB, vidí snímky všech ostatních a může je také **smazat**. U každého snímku je vidět datum, čas a jméno toho, kdo ho uložil.

Snímky starší než **6 měsíců** aplikace **sama maže** (denní úloha). Nejde o účetní doklad – nic jiného se na snímek neodkazuje a jeho smazáním nezmizí žádná provozní data.

> ⚙️ Automatika + 🔒 Server. Zdroj: `functions/src/services/smenarnaRetention.ts` (hranice 6 měsíců na `RETENTION_MONTHS`), plánovaná úloha `sweepSmenarnaSnapshots` v `functions/src/index.ts`.

### Do Recepce se z této tabulky nikdy nic nezapíše

Jediná vazba na Recepci je **čtení** tří kurzů z řádku „sm", kterými se předvyplní řádek **kurz u nás**. Kurz zde můžete přepsat, ale změna platí jen pro tento výpočet – **do Recepce se nikdy nic nezapíše**, a naopak úprava v Recepci nemůže změnit nic v této tabulce ani v uložených snímcích.

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

## Vyřazená pravidla

Pravidla, která dřívější dokumentace uváděla, ale která **v současném kódu neplatí**. Ponechána zde, aby se nevrátila zpět.

### ❌ „Odkaz na smazanou vlastní proměnnou tiše smaže celý odstavec ze smlouvy"

**Neplatí.** Šablona odkazující na smazanou proměnnou je zachycena na třech místech: editor zobrazí varování „Bez nastavení: …", generování se **zablokuje** a proměnná se nabídne k vyplnění. Tiché zmizení odstavce nehrozí.

> Zdroj: `frontend/src/lib/contractVariables.ts:205,287`, `frontend/src/pages/ContractTemplatesPage.tsx:506-511`, `frontend/src/components/GenerateContractModal.tsx:199-201`.

**Co platí dál:** nepárové značky `{{#if}}` / `{{/unless}}` se do dokumentu vypíšou jako text. Není to tichá chyba v původním smyslu (jde o záměrné chování šablonovacího jádra a bloky se dnes korektně zanořují), ale kontrola párovosti při ukládání šablony neexistuje.
> Zdroj: `frontend/src/lib/contractVariables.ts:692-731`, zanoření `:758-760`.

### ❌ „Týdenní úvazek u PPP určuje i hranici přesčasu"

**Neplatí** – určuje pouze nárok na dovolenou. Skutečné chování viz „Poloviční úvazek: dovolená poměrně, ale přesčas až od plné základny" výše.

### ❌ „Datum nástupu vyžaduje zcela nepřerušenou návaznost smluv"

**Nepřesné** – tolerance je až jeden kalendářní měsíc, ne nula. Viz „Datum nástupu je začátek souvislého poměru" výše.
