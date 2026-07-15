// Автогенерация маршрутов и сценариев из билетов ПДД

(function () {
  "use strict";

  const TOPIC_KEYWORDS = [
    { theme: "railway", keys: ["железнодорож", "ж/д", "рельс"] },
    { theme: "signals", keys: ["светофор", "регулировщик", "сигнал светофора"] },
    { theme: "pedestrians", keys: ["пешеход", "переход", "маршрутн"] },
    { theme: "signs", keys: ["знак", "разметк", "дорожн"] },
    { theme: "priority", keys: ["приоритет", "уступ", "главн", "второстепен"] },
    { theme: "parking", keys: ["стоянк", "остановк", "парков", "жилых зон"] },
    { theme: "speed", keys: ["скорост", "автомагистрал"] },
    { theme: "crossroads", keys: ["перекр", "пересечен", "маневр", "поворот", "обгон", "разъезд"] },
  ];

  function inferTheme(questions) {
    const scores = {};
    for (const q of questions) {
      const text = `${q.topic || ""} ${q.q || ""} ${(q.topics || []).join(" ")}`.toLowerCase();
      for (const row of TOPIC_KEYWORDS) {
        if (row.keys.some((k) => text.includes(k))) {
          scores[row.theme] = (scores[row.theme] || 0) + 1;
        }
      }
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best?.[0] || "crossroads";
  }

  function buildDrivePlan(options) {
    const ticket = options.ticket;
    const seed = options.seed ?? Math.floor(Math.random() * 1e6);
    const questions = window.PDD?.byTicket?.(ticket) || [];
    const theme = options.theme || inferTheme(questions);
    const picked = questions.slice(0, Math.min(4, questions.length));
    const checkpoints = picked.map((q, i) => ({
      id: "cp" + i,
      questionId: q.id,
      bankTopic: q.topic || q.topics?.[0] || "",
      sign: guessSign(q),
      label: (q.q || "").slice(0, 80),
    }));
    return { theme, seed, ticket, checkpoints, questionCount: questions.length };
  }

  function guessSign(q) {
    const text = `${q.q || ""} ${q.topic || ""}`.toLowerCase();
    if (text.includes("стоп")) return "stop";
    if (text.includes("уступ")) return "yield";
    if (text.includes("скорост")) return "speed";
    if (text.includes("пешеход") || text.includes("переход")) return "crosswalk";
    if (text.includes("светофор")) return "traffic_light";
    if (text.includes("регулировщик")) return "controller";
    if (text.includes("железнодорож") || text.includes("ж/д")) return "railway";
    if (text.includes("стоянк") || text.includes("парков")) return "parking";
    return "priority";
  }

  function generateScenarioFromTicket(ticket) {
    const questions = window.PDD?.byTicket?.(ticket) || [];
    if (!questions.length) return null;
    const q = questions[Math.floor(Math.random() * questions.length)];
    const theme = inferTheme([q]);
    return {
      id: `ticket-${ticket}-${q.id.slice(-6)}`,
      title: `Билет ${ticket}: ${(q.q || "").slice(0, 48)}…`,
      topic: theme,
      difficulty: 2,
      duration: 15,
      brief: q.q,
      sourceQuestionId: q.id,
      map: { type: theme === "railway" ? "railway" : theme === "signals" ? "signals" : "intersection" },
      decisions: q.options.slice(0, 4).map((label, i) => ({
        id: "opt" + i,
        label,
      })),
      correctDecision: "opt" + (q.correct?.[0] ?? 0),
      outcomes: buildOutcomes(q),
      explanation: q.explanation || "",
      rule: extractRule(q),
    };
  }

  function buildOutcomes(q) {
    const outcomes = {};
    q.options.forEach((label, i) => {
      const ok = q.correct?.includes(i);
      outcomes["opt" + i] = {
        success: ok,
        title: ok ? "Верно" : "Неверно",
        detail: ok ? "Правильный ответ по ПДД." : `Правильно: ${q.correct.map((c) => q.options[c]).join(", ")}`,
        events: ok ? [{ type: "move", id: "player", to: { x: 6.5, y: 10 } }] : [{ type: "near_miss", id: "player" }],
      };
    });
    return outcomes;
  }

  function extractRule(q) {
    const m = (q.explanation || "").match(/[Пп]\.?\s*(\d+[\d.]*)/);
    return m ? m[1] : (q.topic || "ПДД").slice(0, 24);
  }

  window.ScenarioGen = {
    inferTheme,
    buildDrivePlan,
    generateScenarioFromTicket,
    guessSign,
  };
})();
