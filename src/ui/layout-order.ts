const ORDER_KEY = 'choreoloop:panelOrder';

const PANEL_DEFS = [
  { id: 'timeline-card', label: 'Playback & Timeline' },
  { id: 'ab-card', label: 'A-B Loop' },
  { id: 'speed-card', label: 'Speed' },
  { id: 'lyrics-card', label: 'Lyrics' },
] as const;

type PanelId = (typeof PANEL_DEFS)[number]['id'];
const DEFAULT_ORDER: PanelId[] = PANEL_DEFS.map((p) => p.id);

function loadSavedOrder(): PanelId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER];

    const valid = parsed.filter((id): id is PanelId =>
      DEFAULT_ORDER.includes(id as PanelId)
    );
    const missing = DEFAULT_ORDER.filter((id) => !valid.includes(id));
    return [...valid, ...missing];
  } catch {
    return [...DEFAULT_ORDER];
  }
}

function saveOrder(order: PanelId[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage errors
  }
}

export interface LayoutOrderController {
  isEditing: () => boolean;
  setEditing: (editing: boolean) => void;
  toggleEditing: () => boolean;
  resetOrder: () => void;
}

/**
 * Lets the user reorder control panels (Timeline, A-B Loop, Speed, Lyrics)
 * and persists their preference locally in localStorage (never in share links).
 */
export function initLayoutOrder(onDone?: () => void): LayoutOrderController {
  const mainEl = document.querySelector<HTMLElement>('.studio-main');
  if (!mainEl) {
    return {
      isEditing: () => false,
      setEditing: () => {},
      toggleEditing: () => false,
      resetOrder: () => {},
    };
  }

  let order = loadSavedOrder();
  let editing = false;

  const barRefs = new Map<
    PanelId,
    { bar: HTMLDivElement; upBtn: HTMLButtonElement; downBtn: HTMLButtonElement }
  >();

  function applyOrder(): void {
    for (const id of order) {
      const panel = document.getElementById(id);
      if (panel) {
        mainEl!.appendChild(panel);
      }
      const ref = barRefs.get(id);
      if (ref) {
        const idx = order.indexOf(id);
        ref.upBtn.disabled = idx === 0;
        ref.downBtn.disabled = idx === order.length - 1;
      }
    }
  }

  function movePanel(id: PanelId, dir: -1 | 1): void {
    const idx = order.indexOf(id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    order = next;
    saveOrder(order);
    applyOrder();
  }

  for (const def of PANEL_DEFS) {
    const panel = document.getElementById(def.id);
    if (!panel) continue;

    const bar = document.createElement('div');
    bar.className = 'reorder-bar hidden';

    const title = document.createElement('span');
    title.className = 'reorder-label';
    title.textContent = def.label;

    const actions = document.createElement('div');
    actions.className = 'reorder-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn-mini btn-surface';
    upBtn.innerHTML = '&#9650; Up';
    upBtn.setAttribute('aria-label', `Move ${def.label} up`);
    upBtn.addEventListener('click', () => movePanel(def.id, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn-mini btn-surface';
    downBtn.innerHTML = '&#9660; Down';
    downBtn.setAttribute('aria-label', `Move ${def.label} down`);
    downBtn.addEventListener('click', () => movePanel(def.id, 1));

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'btn-mini btn-accent';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => {
      setEditing(false);
      onDone?.();
    });

    actions.append(upBtn, downBtn, doneBtn);
    bar.append(title, actions);
    panel.prepend(bar);
    barRefs.set(def.id, { bar, upBtn, downBtn });
  }

  function setEditing(next: boolean): void {
    editing = next;
    document.body.classList.toggle('is-reordering', editing);
    for (const { bar } of barRefs.values()) {
      bar.classList.toggle('hidden', !editing);
    }
    applyOrder();
  }

  applyOrder();

  return {
    isEditing: () => editing,
    setEditing,
    toggleEditing: () => {
      setEditing(!editing);
      return editing;
    },
    resetOrder: () => {
      order = [...DEFAULT_ORDER];
      saveOrder(order);
      applyOrder();
    },
  };
}
