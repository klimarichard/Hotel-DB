/** The structured change an employee requests for a published-plan cell via the
 *  double-click "Žádost o změnu směny" picker. Shared by the employee dialog and
 *  the admin review views. Legacy reason-only requests have no requestedChange. */
export interface RequestedChange {
  action: "set-type" | "set-hours" | "delete" | "swap";
  value?: string;               // set-type: label e.g. "DA"; set-hours: e.g. "8"
  swapWithEmployeeId?: string;  // swap
  swapWithName?: string;        // swap — denormalized "Surname Firstname" for display
}

/** Human-readable Czech label for the admin review tables. */
export function formatRequestedChange(rc: RequestedChange | null | undefined): string {
  if (!rc) return "—";
  switch (rc.action) {
    case "set-type":
      return rc.value ?? "—";
    case "set-hours":
      return rc.value ? `${rc.value} h` : "—";
    case "delete":
      return "smazat";
    case "swap":
      return `výměna s: ${rc.swapWithName ?? rc.swapWithEmployeeId ?? ""}`;
    default:
      return "—";
  }
}
