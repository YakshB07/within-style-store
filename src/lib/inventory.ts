import { useCallback, useEffect, useState } from "react";

export const SIZES = ["S", "M", "L", "XL"] as const;
export type Size = (typeof SIZES)[number];

export type Inventory = Record<string, Record<Size, number>>;

export const LOW_STOCK_THRESHOLD = 5;

const STORAGE_KEY = "tdw-inventory-v1";

export const DEFAULT_INVENTORY: Inventory = {
  "vayu-zipup": { S: 12, M: 8, L: 3, XL: 0 },
  "agni-pullover": { S: 4, M: 15, L: 9, XL: 2 },
};

function normalize(raw: unknown): Inventory {
  const base: Inventory = JSON.parse(JSON.stringify(DEFAULT_INVENTORY));
  if (!raw || typeof raw !== "object") return base;
  for (const [productId, sizes] of Object.entries(raw as Inventory)) {
    if (!base[productId]) continue;
    for (const size of SIZES) {
      const value = Number(sizes?.[size]);
      if (Number.isFinite(value) && value >= 0) base[productId][size] = Math.floor(value);
    }
  }
  return base;
}

export function useInventory() {
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setInventory(normalize(JSON.parse(stored)));
    } catch {
      /* ignore malformed storage */
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Inventory) => {
    setInventory(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== STORAGE_KEY) return;
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        setInventory(stored ? normalize(JSON.parse(stored)) : DEFAULT_INVENTORY);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setStock = useCallback(
    (productId: string, size: Size, quantity: number) => {
      setInventory((prev) => {
        const next: Inventory = {
          ...prev,
          [productId]: { ...prev[productId], [size]: Math.max(0, Math.floor(quantity) || 0) } as Record<Size, number>,
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const decrementStock = useCallback((productId: string, size: Size) => {
    setInventory((prev) => {
      const current = prev[productId]?.[size] ?? 0;
      if (current <= 0) return prev;
      const next: Inventory = {
        ...prev,
        [productId]: { ...prev[productId], [size]: current - 1 } as Record<Size, number>,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const zeroed: Inventory = {
      "vayu-zipup": { S: 0, M: 0, L: 0, XL: 0 },
      "agni-pullover": { S: 0, M: 0, L: 0, XL: 0 },
    };
    persist(zeroed);
  }, [persist]);

  return { inventory, hydrated, setStock, decrementStock, reset };
}

export function stockLabel(quantity: number): { text: string; tone: "out" | "low" | "in" } {
  if (quantity <= 0) return { text: "Sold Out", tone: "out" };
  if (quantity < LOW_STOCK_THRESHOLD) return { text: `Only ${quantity} left in stock`, tone: "low" };
  return { text: "In Stock", tone: "in" };
}
