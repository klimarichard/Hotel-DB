/**
 * Seeds all 9 contract templates into Firestore emulator.
 * Templates use {{variableName}} placeholders matching contractVariables.ts.
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-templates.js
 * Emulators must be running first.
 * Idempotent — safe to re-run (will overwrite existing templates).
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract {{key}} variable names from an HTML string */
function extractVars(html) {
  return [...new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];
}

/** Shared header block used in all templates */
const header = `
<div style="text-align:right;font-size:9pt;color:#333;margin-bottom:24px;border-bottom:1px solid #ccc;padding-bottom:8px;">
  <strong>{{companyName}}</strong><br/>
  {{companyAddress}}<br/>
  IČO: {{ic}}&nbsp;&nbsp;DIČ: {{dic}}
</div>`.trim();

/** Shared signature block */
const signatures = `
<div style="margin-top:48px;">
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="width:48%;vertical-align:top;">
        <p style="border-top:1px solid #000;padding-top:4px;margin-top:40px;">
          Za zaměstnavatele:<br/>
          <strong>{{signatoryName}}</strong><br/>
          {{signatoryTitle}}<br/>
          {{companyName}}
        </p>
      </td>
      <td style="width:4%;"></td>
      <td style="width:48%;vertical-align:top;">
        <p style="border-top:1px solid #000;padding-top:4px;margin-top:40px;">
          Zaměstnanec:<br/>
          <strong>{{fullName}}</strong><br/>
          Datum narození: {{birthDate}}<br/>
          Číslo OP: {{idCardNumber}}
        </p>
      </td>
    </tr>
  </table>
  <p style="margin-top:16px;">V Praze dne <strong>{{today}}</strong></p>
</div>`.trim();

// ─── Template definitions ─────────────────────────────────────────────────────

const TEMPLATES = [
  // ── 1. Nástup HPP ────────────────────────────────────────────────────────────
  {
    id: 'nastup_hpp',
    type: 'nastup_hpp',
    name: 'Nástup HPP',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">PRACOVNÍ SMLOUVA</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
trvalé bydliště: {{address}}, {{city}}, PSČ: {{zip}},<br/>
číslo OP: {{idCardNumber}}, rodné číslo: {{birthNumber}}</p>

<p>uzavírají níže uvedeného dne tuto pracovní smlouvu:</p>

<h3>I. Druh práce</h3>
<p>Zaměstnavatel přijímá zaměstnance na pozici <strong>{{currentJobTitle}}</strong>, oddělení: <strong>{{currentDepartment}}</strong>.</p>

<h3>II. Místo výkonu práce</h3>
<p>{{companyAddress}}</p>

<h3>III. Den nástupu do práce</h3>
<p>Zaměstnanec nastupuje do práce dne <strong>{{startDate}}</strong>.</p>

<h3>IV. Mzda</h3>
<p>Zaměstnanec bude odměňován měsíční mzdou ve výši <strong>{{salary}} Kč</strong> hrubého.
Mzda je splatná vždy k poslednímu dni příslušného kalendářního měsíce.</p>

<h3>V. Pracovní doba</h3>
<p>Pracovní doba je stanovena na 40 hodin týdně (plný pracovní úvazek — HPP).
Rozvržení pracovní doby se řídí vnitřním předpisem zaměstnavatele.</p>

<h3>VI. Zkušební doba</h3>
<p>Sjednává se zkušební doba v délce 3 měsíců ode dne nástupu do práce.</p>

<h3>VII. Ostatní ujednání</h3>
<p>Tato smlouva se řídí zákoníkem práce č. 262/2006 Sb. v platném znění.
Zaměstnanec prohlašuje, že byl seznámen s pracovním řádem a vnitřními předpisy zaměstnavatele.</p>

${signatures}
</div>`,
  },

  // ── 2. Nástup PPP ────────────────────────────────────────────────────────────
  {
    id: 'nastup_ppp',
    type: 'nastup_ppp',
    name: 'Nástup PPP',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">DOHODA O PRACOVNÍ ČINNOSTI</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
trvalé bydliště: {{address}}, {{city}}, PSČ: {{zip}},<br/>
číslo OP: {{idCardNumber}}, rodné číslo: {{birthNumber}}</p>

<p>uzavírají tuto dohodu o pracovní činnosti:</p>

<h3>I. Druh práce</h3>
<p>Zaměstnanec bude pro zaměstnavatele vykonávat práci: <strong>{{currentJobTitle}}</strong>.</p>

<h3>II. Rozsah práce</h3>
<p>Práce bude vykonávána v rozsahu nepřekračujícím v průměru polovinu stanovené týdenní pracovní doby.</p>

<h3>III. Odměna</h3>
<p>Odměna za vykonanou práci činí <strong>{{salary}} Kč</strong> měsíčně.
Je splatná vždy k poslednímu dni kalendářního měsíce.</p>

<h3>IV. Doba trvání</h3>
<p>Dohoda se uzavírá od <strong>{{startDate}}</strong>{{endDate}}.</p>

<h3>V. Ostatní ujednání</h3>
<p>Tato dohoda se řídí zákoníkem práce č. 262/2006 Sb. v platném znění.</p>

${signatures}
</div>`,
  },

  // ── 3. Nástup DPP ────────────────────────────────────────────────────────────
  {
    id: 'nastup_dpp',
    type: 'nastup_dpp',
    name: 'Nástup DPP',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">DOHODA O PROVEDENÍ PRÁCE</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
trvalé bydliště: {{address}}, {{city}}, PSČ: {{zip}},<br/>
číslo OP: {{idCardNumber}}, rodné číslo: {{birthNumber}}</p>

<p>uzavírají tuto dohodu o provedení práce:</p>

<h3>I. Pracovní úkol</h3>
<p>Zaměstnanec se zavazuje pro zaměstnavatele vykonat práci: <strong>{{currentJobTitle}}</strong>.</p>

<h3>II. Rozsah práce</h3>
<p>Práce bude vykonána v rozsahu nepřekračujícím 300 hodin v kalendářním roce
u jednoho zaměstnavatele.</p>

<h3>III. Odměna</h3>
<p>Zaměstnanec obdrží za vykonanou práci odměnu ve výši <strong>{{salary}} Kč</strong>.
Odměna je splatná po vykonání sjednané práce, nejpozději do konce příslušného
kalendářního měsíce.</p>

<h3>IV. Doba, na kterou se dohoda uzavírá</h3>
<p>Dohoda se uzavírá od <strong>{{startDate}}</strong> do <strong>{{endDate}}</strong>.</p>

<h3>V. Ostatní ujednání</h3>
<p>Tato dohoda se řídí zákoníkem práce č. 262/2006 Sb. v platném znění.
Zaměstnanec prohlašuje, že je dostatečně způsobilý k výkonu sjednané práce.</p>

${signatures}
</div>`,
  },

  // ── 4. Ukončení HPP / PPP ─────────────────────────────────────────────────────
  {
    id: 'ukonceni_hpp_ppp',
    type: 'ukonceni_hpp_ppp',
    name: 'Ukončení HPP/PPP',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">DOHODA O ROZVÁZÁNÍ PRACOVNÍHO POMĚRU</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
číslo OP: {{idCardNumber}}, rodné číslo: {{birthNumber}}</p>

<p>uzavírají v souladu s § 49 zákoníku práce dohodu o rozvázání pracovního poměru:</p>

<h3>I. Rozvázání pracovního poměru</h3>
<p>Pracovní poměr zaměstnance na pozici <strong>{{currentJobTitle}}</strong>
v oddělení <strong>{{currentDepartment}}</strong> se rozvazuje dohodou ke dni
<strong>{{endDate}}</strong>.</p>

<h3>II. Vypořádání nároků</h3>
<p>Ke dni skončení pracovního poměru zaměstnanec odevzdá veškeré svěřené
prostředky, přístupové karty a klíče, výpočetní techniku a dokumentaci.
Zaměstnavatel provede řádné mzdové a daňové vypořádání v souladu s
platnými předpisy.</p>

<h3>III. Závěrečná ustanovení</h3>
<p>Obě smluvní strany prohlašují, že dohodu uzavřely svobodně, vážně a bez nátlaku,
a na důkaz souhlasu ji podepisují.</p>

${signatures}
</div>`,
  },

  // ── 5. Ukončení DPP ──────────────────────────────────────────────────────────
  {
    id: 'ukonceni_dpp',
    type: 'ukonceni_dpp',
    name: 'Ukončení DPP',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">UKONČENÍ DOHODY O PROVEDENÍ PRÁCE</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
číslo OP: {{idCardNumber}}</p>

<p>se dohodli na ukončení dohody o provedení práce:</p>

<h3>I. Ukončení dohody</h3>
<p>Dohoda o provedení práce uzavřená dne <strong>{{startDate}}</strong>
na výkon práce <strong>{{currentJobTitle}}</strong> se ukončuje ke dni
<strong>{{endDate}}</strong>.</p>

<h3>II. Odměna</h3>
<p>Odměna za skutečně vykonanou práci bude zaměstnanci vyplacena
v nejbližším výplatním termínu.</p>

${signatures}
</div>`,
  },

  // ── 6. Ukončení ve zkušební době ─────────────────────────────────────────────
  {
    id: 'ukonceni_zkusebni',
    type: 'ukonceni_zkusebni',
    name: 'Ukončení ve zkušební době',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">ZRUŠENÍ PRACOVNÍHO POMĚRU VE ZKUŠEBNÍ DOBĚ</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>oznamuje zaměstnanci:</p>

<p><strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
číslo OP: {{idCardNumber}}</p>

<h3>Zrušení pracovního poměru ve zkušební době</h3>
<p>V souladu s § 66 zákoníku práce č. 262/2006 Sb. v platném znění ruší zaměstnavatel
pracovní poměr ve zkušební době.</p>

<p>Pracovní poměr na pozici <strong>{{currentJobTitle}}</strong> skončí dnem
<strong>{{endDate}}</strong>.</p>

<p>Ke dni skončení pracovního poměru zaměstnanec odevzdá veškeré svěřené
prostředky a přístupové karty.</p>

${signatures}
</div>`,
  },

  // ── 7. Změna smlouvy (dodatek) ───────────────────────────────────────────────
  {
    id: 'zmena_smlouvy',
    type: 'zmena_smlouvy',
    name: 'Změna smlouvy (dodatek)',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">DODATEK K PRACOVNÍ SMLOUVĚ</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
číslo OP: {{idCardNumber}}, rodné číslo: {{birthNumber}}</p>

<p>uzavírají tento dodatek k pracovní smlouvě:</p>

<h3>I. Změna podmínek</h3>
<p>S účinností od <strong>{{startDate}}</strong> se mění pracovní smlouva
zaměstnance takto:</p>

<ul>
  <li>Pracovní zařazení: <strong>{{currentJobTitle}}</strong></li>
  <li>Oddělení: <strong>{{currentDepartment}}</strong></li>
  <li>Mzda: <strong>{{salary}} Kč</strong> hrubého měsíčně</li>
</ul>

<h3>II. Ostatní ujednání</h3>
<p>Ostatní podmínky pracovní smlouvy zůstávají nezměněny.
Tento dodatek nabývá platnosti a účinnosti dnem podpisu oběma smluvními stranami.</p>

${signatures}
</div>`,
  },

  // ── 8. Hmotná odpovědnost ────────────────────────────────────────────────────
  {
    id: 'hmotna_odpovednost',
    type: 'hmotna_odpovednost',
    name: 'Hmotná odpovědnost',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">DOHODA O ODPOVĚDNOSTI ZA SVĚŘENÉ HODNOTY</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
pracovní pozice: {{currentJobTitle}}, oddělení: {{currentDepartment}},<br/>
číslo OP: {{idCardNumber}}, rodné číslo: {{birthNumber}}</p>

<p>uzavírají v souladu s § 252 zákoníku práce tuto dohodu:</p>

<h3>I. Předmět dohody</h3>
<p>Zaměstnanec přebírá odpovědnost za hodnoty svěřené k vyúčtování
(hotovost, cennosti, zboží, zásoby materiálu nebo jiné hodnoty), které
je zaměstnanec povinen vyúčtovat.</p>

<h3>II. Povinnosti zaměstnance</h3>
<p>Zaměstnanec je povinen:
<br/>a) řádně hospodařit se svěřenými hodnotami,
<br/>b) neprodleně hlásit zjištěné schodky nebo ztráty nadřízenému pracovníkovi,
<br/>c) podrobit se inventarizaci svěřených hodnot kdykoliv o to zaměstnavatel požádá.</p>

<h3>III. Odpovědnost za schodek</h3>
<p>Vznikne-li na svěřených hodnotách schodek, je zaměstnanec povinen jej uhradit v plné výši,
s výjimkou případů, kdy schodek byl způsoben zcela nebo zčásti bez jeho zavinění.</p>

<h3>IV. Platnost dohody</h3>
<p>Dohoda se uzavírá na dobu neurčitou s účinností od <strong>{{today}}</strong>.
Zaměstnanec může od dohody odstoupit, pokud mu zaměstnavatel nevytvoří podmínky
k zajištění svěřených hodnot.</p>

${signatures}
</div>`,
  },

  // ── 9. Multisport ────────────────────────────────────────────────────────────
  {
    id: 'multisport',
    type: 'multisport',
    name: 'Multisport',
    html: `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000;max-width:800px;margin:0 auto;">
${header}
<h2 style="text-align:center;letter-spacing:1px;">DOHODA O POSKYTNUTÍ BENEFITU MULTISPORT</h2>
<p style="text-align:center;color:#555;margin-top:-8px;">č. {{contractNumber}}</p>

<p>Zaměstnavatel: <strong>{{companyName}}</strong>, se sídlem {{companyAddress}}, IČO: {{ic}},<br/>
zastoupený: <strong>{{signatoryName}}</strong>, {{signatoryTitle}}</p>

<p>a</p>

<p>Zaměstnanec: <strong>{{fullName}}</strong>, datum narození: {{birthDate}},<br/>
číslo OP: {{idCardNumber}}</p>

<p>uzavírají tuto dohodu o poskytnutí zaměstnaneckého benefitu:</p>

<h3>I. Předmět dohody</h3>
<p>Zaměstnavatel se zavazuje zaměstnanci zprostředkovat kartu Multisport
umožňující přístup do partnerských sportovních zařízení.
Zaměstnanec souhlasí s podmínkami programu Multisport Card.</p>

<h3>II. Příspěvek zaměstnavatele</h3>
<p>Zaměstnavatel hradí měsíční příspěvek na kartu Multisport jako
nepeněžní zaměstnanecký benefit v souladu s platnými daňovými předpisy.</p>

<h3>III. Podmínky poskytnutí</h3>
<p>Benefit se poskytuje na dobu trvání pracovního poměru.
V případě ukončení pracovního poměru je zaměstnanec povinen kartu
vrátit nejpozději v den skončení pracovního poměru.</p>

<h3>IV. Účinnost</h3>
<p>Dohoda nabývá účinnosti dnem podpisu oběma smluvními stranami (<strong>{{today}}</strong>).</p>

${signatures}
</div>`,
  },
];

// ─── Seed function ────────────────────────────────────────────────────────────

async function run() {
  for (const tmpl of TEMPLATES) {
    const variables = extractVars(tmpl.html);
    await db.collection('contractTemplates').doc(tmpl.id).set({
      type: tmpl.type,
      name: tmpl.name,
      htmlContent: tmpl.html,
      variables,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'seed',
    }, { merge: false }); // full overwrite for clean seed
    console.log(`  ✓ contractTemplates/${tmpl.id} — ${tmpl.name} (${variables.length} variables)`);
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('\nTemplates seeded.'); process.exit(0); })
    .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
