import { useCallback, useEffect, useState } from "react";
import { LegacyShell, type ViewId } from "./LegacyShell";

declare global {
  interface Window {
    PDD?: {
      isReady?: () => boolean;
      remount?: () => Promise<number>;
      getRegion?: () => { country: string; category: string };
    };
    RoadMind?: { init?: () => void; onShow?: () => void; resize?: () => void };
  }
}

const VIEWS = [
  { id: "tickets", title: "Билеты", icon: "📋" },
  { id: "topics", title: "Темы", icon: "📚" },
  { id: "exam", title: "Экзамен", icon: "🎯" },
  { id: "sim", title: "RoadMind", icon: "🛣" },
  { id: "stats", title: "Статистика", icon: "📊" },
  { id: "settings", title: "Настройки", icon: "⚙️" },
] as const;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewId>("tickets");

  useEffect(() => {
    document.body.classList.add("compact");
    (async () => {
      await loadScript("/vendor/pixi.min.js");
      await loadScript("/citygen.js");
      await loadScript("/sprites.js");
      await loadScript("/scenario-gen.js");
      await loadScript("/drive.js");
      await loadScript("/app.js");
      await loadScript("/roadmind.js");
      setReady(true);
    })().catch(console.error);
  }, []);

  const onNav = useCallback((id: ViewId) => {
    setView(id);
    requestAnimationFrame(() => {
      document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
      document.getElementById(`view-${id}`)?.classList.remove("hidden");
      if (id === "sim") window.RoadMind?.onShow?.();
    });
  }, []);

  if (!ready) {
    return (
      <div className="app-shell" style={{ placeItems: "center", padding: 40 }}>
        <p className="muted">Загрузка RoadMind…</p>
      </div>
    );
  }

  return (
    <>
      <LegacyShell view={view} onNav={onNav} />
      <nav className="bottom-nav" id="bottom-nav" aria-label="Навигация">
        {VIEWS.filter((v) => v.id !== "settings").map((v) => (
          <button
            key={v.id}
            type="button"
            className={`bn-item${view === v.id ? " active" : ""}`}
            data-view={v.id}
            onClick={() => onNav(v.id as ViewId)}
          >
            {v.icon}
          </button>
        ))}
      </nav>
    </>
  );
}
