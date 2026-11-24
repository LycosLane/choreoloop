const ORDER_KEY = 'choreoloop:panelOrder';

const PANEL_DEFS = [
  { id: 'timeline-card', label: 'Playback & Timeline' },
  { id: 'ab-card', label: 'A-B Loop' },
  { id: 'speed-card', label: 'Speed' },
  { id: 'lyrics-card', label: 'Lyrics' },
] as const;

export type PanelId = (typeof PANEL_DEFS)[number]['id'];
const DEFAULT_ORDER: PanelId[] = PANEL_DEFS.map((p) => p.id);

/**
 * Normalizes a persisted panel-order value into a deduplicated, complete PanelId list.
 */
export function reconcilePanelOrder(parsed: unknown): PanelId[] {
  if (!Array.isArray(parsed)) return [...DEFAULT_ORDER];
  const seen = new Set<PanelId>();
  const valid: PanelId[] = [];
  for (const id of parsed) {
    if (DEFAULT_ORDER.includes(id as PanelId) && !seen.has(id as PanelId)) {
      seen.add(id as PanelId);
      valid.push(id as PanelId);
    }
  }
  const missing = DEFAULT_ORDER.filter((id) => !seen.has(id));
  return [...valid, ...missing];
}

/**
 * Moves `id` up (-1) or down (+1) across currently visible panels.
 */
export function movePanelInOrder(
  order: readonly PanelId[],
  id: PanelId,
  dir: -1 | 1,
  hiddenIds: ReadonlySet<PanelId> = new Set()
): PanelId[] {
  const idx = order.indexOf(id);
  if (idx < 0) return [...order];
  let target = idx + dir;
  while (target >= 0 && target < order.length && hiddenIds.has(order[target])) {
    target += dir;
  }
  if (target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

function loadSavedOrder(): PanelId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    return reconcilePanelOrder(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_ORDER];
  }
}

function saveOrder(order: PanelId[]): boolean {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    return true;
  } catch {
    return false;
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

  function getHiddenIds(): Set<PanelId> {
    const hidden = new Set<PanelId>();
    for (const id of order) {
      const panel = document.getElementById(id);
      if (panel?.classList.contains('hidden')) {
        hidden.add(id);
      }
    }
    return hidden;
  }

  function applyOrder(): void {
    const orderedPanels = order
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const currentPanels = Array.from(mainEl!.children).filter((el): el is HTMLElement =>
      DEFAULT_ORDER.includes(el.id as PanelId)
    );
    const orderChanged =
      orderedPanels.length !== currentPanels.length ||
      orderedPanels.some((panel, i) => currentPanels[i] !== panel);

    if (orderChanged) {
      const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      for (const panel of orderedPanels) {
        mainEl!.appendChild(panel);
      }
      if (activeEl && mainEl!.contains(activeEl)) {
        activeEl.focus();
      }
    }

    const hidden = getHiddenIds();
    const visibleOrder = order.filter((id) => !hidden.has(id));
    for (const id of order) {
      const ref = barRefs.get(id);
      if (ref) {
        const vIdx = visibleOrder.indexOf(id);
        ref.upBtn.disabled = vIdx <= 0;
        ref.downBtn.disabled = vIdx < 0 || vIdx >= visibleOrder.length - 1;
      }
    }
  }

  function movePanel(id: PanelId, dir: -1 | 1): void {
    const next = movePanelInOrder(order, id, dir, getHiddenIds());
    if (next.every((panelId, i) => panelId === order[i])) return;
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
