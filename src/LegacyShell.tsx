import { useCallback, useEffect, useState } from "react";

export type ViewId = "tickets" | "topics" | "exam" | "sim" | "stats" | "settings";

type Props = {
  view: ViewId;
  onNav: (id: ViewId) => void;
};

function syncBankBadge(count: number) {
  const el = document.getElementById("bank-status");
  if (!el) return;
  if (count > 0) {
    el.textContent = `${count} вопросов`;
    el.className = "badge badge-new";
  }
}

export function LegacyShell({ view, onNav }: Props) {
  const [viewsHtml, setViewsHtml] = useState("");
  const [bankStatus, setBankStatus] = useState("Загрузка…");

  const remount = useCallback(async () => {
    const n = await window.PDD?.remount?.();
    if (typeof n === "number" && n > 0) {
      const label = `${n} вопросов`;
      setBankStatus(label);
      syncBankBadge(n);
    }
    window.RoadMind?.resize?.();
    return n;
  }, []);

  useEffect(() => {
    fetch("/index.legacy.html")
      .then((r) => r.text())
      .then((text) => {
        const doc = new DOMParser().parseFromString(text, "text/html");
        const main = doc.querySelector("main.app-main");
        setViewsHtml(main?.innerHTML || "");
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    void remount();
  }, [remount]);

  useEffect(() => {
    const onBank = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (n > 0) setBankStatus(`${n} вопросов`);
    };
    window.addEventListener("pdd:bank-loaded", onBank);
    return () => window.removeEventListener("pdd:bank-loaded", onBank);
  }, []);

  useEffect(() => {
    if (!viewsHtml) return;
    void remount();
  }, [viewsHtml, remount]);

  useEffect(() => {
    if (!viewsHtml) return;
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById(`view-${view}`)?.classList.remove("hidden");
    window.RoadMind?.onShow?.();
    window.RoadMind?.resize?.();
  }, [view, viewsHtml]);

  useEffect(() => {
    if (viewsHtml) window.RoadMind?.init?.();
  }, [viewsHtml]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void remount();
      }, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [remount]);

  const titles: Record<string, string> = {
    tickets: "Билеты",
    topics: "Темы",
    exam: "Экзамен",
    sim: "RoadMind",
    stats: "Статистика",
    settings: "Настройки",
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">◉</span>
          <div>
            <div className="brand-title">RoadMind</div>
            <div className="brand-sub">ПДД · Vite + React</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {[
            ["tickets", "📋 Билеты"],
            ["topics", "📚 Темы"],
            ["exam", "🎯 Экзамен"],
            ["sim", "🛣 Симуляции"],
            ["stats", "📊 Статистика"],
            ["settings", "⚙️ Настройки"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`nav-item${view === id ? " active" : ""}`}
              data-view={id}
              onClick={() => onNav(id as ViewId)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <label className="field compact stack">
            Страна
            <select id="region-country">
              <option value="ru">Россия</option>
              <option value="by">Беларусь</option>
            </select>
          </label>
          <label className="field compact stack" id="region-category-wrap">
            Категория
            <select id="region-category">
              <option value="ab">A/B</option>
              <option value="cd">C/D</option>
            </select>
          </label>
        </div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn sidebar-toggle"
            aria-label="Меню"
            onClick={() => document.getElementById("sidebar")?.classList.toggle("open")}
          >
            ☰
          </button>
          <h1 className="view-title" id="view-title">
            {titles[view] || view}
          </h1>
          <span className="badge badge-due" id="bank-status">
            {bankStatus}
          </span>
        </header>

        <main
          className="app-main"
          dangerouslySetInnerHTML={viewsHtml ? { __html: viewsHtml } : undefined}
        />
      </div>
    </div>
  );
}
