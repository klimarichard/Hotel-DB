import type { TourStep, TourDefinition } from "./types";
import { employeeBaseSteps } from "./employeeTour";

/**
 * Extra step shown only to managers (FOM). Inserted immediately after the
 * "shift-grid" step that the employee tour already contains.
 */
const managerShiftGridStep: TourStep = {
  anchor: "shift-grid",
  title: "Vyplňování plánu (pouze FOM)",
  body: "Jako FOM (Front Office Manager) můžete v otevřeném plánu přímo upravovat směny všech zaměstnanců: kliknutím do buňky zapíšete kód směny (např. DA, NS, X), mažete nebo přepisujete existující záznamy. Plán v ostatních stavech (uzavřený, publikovaný) je jen pro čtení; přechody mezi stavy provádí administrátor nebo ředitel.",
  placement: "top",
};

const shiftGridIndex = employeeBaseSteps.findIndex(
  (step) => step.anchor === "shift-grid"
);

/**
 * Manager steps = employee base steps with one extra FOM-only step
 * inserted immediately after the "shift-grid" step.
 */
const managerSteps: TourStep[] = [
  ...employeeBaseSteps.slice(0, shiftGridIndex + 1),
  managerShiftGridStep,
  ...employeeBaseSteps.slice(shiftGridIndex + 1),
];

export const managerTour: TourDefinition = {
  id: "manager",
  version: 1,
  label: "Prohlídka pro vedoucí (FOM)",
  steps: managerSteps,
};
