/**
 * Master seed script — runs all individual seeds in the correct order:
 *   1. seed-companies   (companies/HPM, companies/STP)
 *   2. seed-employees   (from DTB.xlsx — must exist at project root)
 *   3. seed-users       (director, manager, 2 × employee — links to employees)
 *   4. seed-templates   (all 9 contract templates)
 *   5. seed-shift-plan  (current-month plan with employees + past-day shifts)
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-all.js
 * Emulators must be running first.
 * DTB.xlsx must be present at project root (for seed-employees step).
 *
 * Each step runs as a child process so firebase-admin is initialised fresh
 * per step and there are no multiple-app conflicts.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPTS = [
  'seed-companies.js',
  'seed-employees.js',
  'seed-users.js',
  'seed-templates.js',
  'seed-shift-plan.js',
];

let allOk = true;

for (const script of SCRIPTS) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶  ${script}`);
  console.log('─'.repeat(60));

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, script)],
    { stdio: 'inherit', env: process.env }
  );

  if (result.status !== 0) {
    console.error(`\n✗ ${script} failed (exit ${result.status ?? 'unknown'})`);
    allOk = false;
    break;
  }
}

if (allOk) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('✓  All seeds complete.');
  console.log('─'.repeat(60));
  console.log('\nKey credentials (from DTB.csv):');
  console.log('  admin@hotel.local     admin123   (admin)');
  console.log('  vondra@hotel.local    vondra1    (director)');
  console.log('  kalinina@hotel.local  kalinina1  (manager)');
  console.log('  afanaseva@hotel.local afanaseva1 (employee)');
  console.log('  — plus 30 more employee/manager accounts from DTB.csv');
}

process.exit(allOk ? 0 : 1);
