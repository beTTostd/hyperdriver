"use client";

import { Children, type KeyboardEvent, type ReactNode, useId, useState } from "react";
import styles from "./page.module.css";

type AnalysisTab = {
  id: string;
  label: string;
  description: string;
};

export default function AnalysisTabs({
  items,
  children,
}: {
  items: AnalysisTab[];
  children: ReactNode;
}) {
  const tabSetId = useId();
  const panels = Children.toArray(children);
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  function focusTab(index: number) {
    const item = items[index];
    if (!item) return;
    setActiveId(item.id);
    requestAnimationFrame(() => document.getElementById(`${tabSetId}-${item.id}-tab`)?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    focusTab(nextIndex);
  }

  return (
    <div className={styles.analysisTabs}>
      <div className={styles.tabList} role="tablist" aria-label="Seções da análise da partida">
        {items.map((item, index) => {
          const isActive = item.id === activeId;
          return (
            <button
              aria-controls={`${tabSetId}-${item.id}-panel`}
              aria-selected={isActive}
              className={styles.tabButton}
              id={`${tabSetId}-${item.id}-tab`}
              key={item.id}
              onClick={() => setActiveId(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          );
        })}
      </div>

      {items.map((item, index) => (
        <div
          aria-labelledby={`${tabSetId}-${item.id}-tab`}
          className={styles.tabPanel}
          hidden={item.id !== activeId}
          id={`${tabSetId}-${item.id}-panel`}
          key={item.id}
          role="tabpanel"
          tabIndex={0}
        >
          {panels[index]}
        </div>
      ))}
    </div>
  );
}
