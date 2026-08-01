import { describe, expect, it } from "vitest";
import {
  classifyPrepLead,
  derivePrepTasks,
  isUrgentPrep,
  prepDueDate,
  serviceDateFor,
  stripShelfLifeClauses,
} from "@/modules/production/domain/prep-lead-time";

// BR-3

const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("classifyPrepLead", () => {
  // Strings taken verbatim from Kosh_Cycle_Planner.html
  it.each([
    ["Marinate cod 3 DAYS PRIOR", "D3"],
    ["Marinate salmon 24HR PRIOR", "H24"],
    ["Ferment batter 18HR PRIOR", "DAY_BEFORE"],
    ["Soak overnight", "DAY_BEFORE"],
    ["Marinate chicken 2hr+", "SAME_DAY"],
    ["Cook lentils AM", "SAME_DAY"],
    ["Pre-make basil oil", "SAME_DAY"],
  ])("classifies %s as %s", (text, expected) => {
    expect(classifyPrepLead(text)).toBe(expected);
  });

  it("prefers the longest lead when several appear", () => {
    expect(classifyPrepLead("Marinate overnight, then 3 days ageing")).toBe("D3");
    expect(classifyPrepLead("Soak overnight then 24hr cure")).toBe("H24");
  });

  it("is case insensitive", () => {
    expect(classifyPrepLead("marinate 24 hours prior")).toBe("H24");
    expect(classifyPrepLead("MARINATE 3 DAYS")).toBe("D3");
  });

  // A duration can describe how long something KEEPS rather than how far ahead
  // it must start. The prototype conflated the two and scheduled basil oil
  // three days early — arriving at the end of its shelf life on service day.
  describe("shelf life is not lead time", () => {
    it.each([
      "Pre-make basil oil (3 days shelf life)",
      "Cook lentil batch Mon AM — keeps 4 days",
      "Make chutney (lasts 3 days refrigerated)",
      "Batch the paste — good for 3 days",
    ])("treats %s as same-day work", (text) => {
      expect(classifyPrepLead(text)).toBe("SAME_DAY");
    });

    it("still reads a genuine lead time in the same sentence", () => {
      expect(classifyPrepLead("Cure salmon 3 days prior (keeps 5 days after)")).toBe("D3");
      expect(classifyPrepLead("Marinate 24hr prior — keeps 3 days")).toBe("H24");
    });

    it("leaves hyphenated words alone when stripping clauses", () => {
      expect(stripShelfLifeClauses("Pre-make basil oil")).toBe("Pre-make basil oil");
    });

    it("keeps trailing emphasis that is not about shelf life", () => {
      expect(classifyPrepLead("24hr marinade — less is noticeably inferior")).toBe("H24");
      expect(classifyPrepLead("Ferment batter 18hr before — mandatory")).toBe("DAY_BEFORE");
    });
  });
});

describe("isUrgentPrep", () => {
  it("marks text containing PRIOR or mandatory", () => {
    expect(isUrgentPrep("Marinate 2hr PRIOR")).toBe(true);
    expect(isUrgentPrep("This step is mandatory")).toBe(true);
  });

  it("marks anything needing a day or more regardless of wording", () => {
    expect(isUrgentPrep("Cure for 24hr")).toBe(true);
    expect(isUrgentPrep("Age 3 days")).toBe(true);
  });

  it("leaves same-day work unmarked", () => {
    expect(isUrgentPrep("Chop the shallots")).toBe(false);
  });
});

describe("prepDueDate", () => {
  const service = new Date("2026-08-10T00:00:00.000Z");

  it.each([
    ["SAME_DAY", "2026-08-10"],
    ["DAY_BEFORE", "2026-08-09"],
    ["H24", "2026-08-09"],
    ["D3", "2026-08-07"],
  ] as const)("offsets %s to %s", (type, expected) => {
    expect(iso(prepDueDate(service, type))).toBe(expected);
  });

  it("crosses a month boundary correctly", () => {
    expect(iso(prepDueDate(new Date("2026-08-02T00:00:00.000Z"), "D3"))).toBe("2026-07-30");
  });

  it("returns null when the cycle has no start date", () => {
    expect(prepDueDate(null, "D3")).toBeNull();
  });
});

describe("serviceDateFor", () => {
  it("counts day 1 as the start date itself", () => {
    expect(iso(serviceDateFor(new Date("2026-08-01T00:00:00.000Z"), 1))).toBe("2026-08-01");
  });

  it("advances one day per cycle day", () => {
    expect(iso(serviceDateFor(new Date("2026-08-01T00:00:00.000Z"), 28))).toBe("2026-08-28");
  });

  it("returns null without a start date", () => {
    expect(serviceDateFor(null, 5)).toBeNull();
  });
});

describe("derivePrepTasks", () => {
  const base = {
    cycleDayId: "day-3",
    dayNumber: 3,
    mealType: "DI",
    mealAssignmentId: "assign-1",
    weekStart: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("ignores ordinary cooking steps", () => {
    const tasks = derivePrepTasks({
      ...base,
      steps: [{ stepNumber: 1, title: "Sear", instructions: "Sear the fillet.", criticality: "info" }],
    });
    expect(tasks).toEqual([]);
  });

  it("derives a task from a mandatory step with its lead time and due date", () => {
    const tasks = derivePrepTasks({
      ...base,
      steps: [
        { stepNumber: 2, title: "Marinate", instructions: "Marinate salmon 24HR PRIOR", criticality: "mandatory" },
      ],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sourceKey: "day-3:DI:2",
      taskType: "H24",
      urgent: true,
      taskText: "Marinate: Marinate salmon 24HR PRIOR",
    });
    // Day 3 of a cycle starting 1 Aug is 3 Aug; 24hr prior is 2 Aug.
    expect(iso(tasks[0].dueDate)).toBe("2026-08-02");
  });

  it("treats a mandatory step as urgent even when the text is neutral", () => {
    const [task] = derivePrepTasks({
      ...base,
      steps: [{ stepNumber: 1, title: "Rest", instructions: "Rest the dough.", criticality: "mandatory" }],
    });
    expect(task.urgent).toBe(true);
  });

  it("produces a stable source key for idempotent regeneration", () => {
    const steps = [{ stepNumber: 4, title: "Ferment", instructions: "Ferment 18HR PRIOR", criticality: "warning" }];
    const first = derivePrepTasks({ ...base, steps });
    const second = derivePrepTasks({ ...base, steps });
    expect(first[0].sourceKey).toBe(second[0].sourceKey);
    expect(first[0].sourceKey).toBe("day-3:DI:4");
  });

  it("creates tasks without due dates when the cycle has no start date", () => {
    const [task] = derivePrepTasks({
      ...base,
      weekStart: null,
      steps: [{ stepNumber: 1, title: "Marinate", instructions: "3 days prior", criticality: "mandatory" }],
    });
    expect(task.dueDate).toBeNull();
    expect(task.taskType).toBe("D3");
  });
});
