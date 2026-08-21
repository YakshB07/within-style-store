import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { getRequestIP, useSession } from "@tanstack/react-start/server";
import { useEffect, useState } from "react";
import { z } from "zod";
import { SIZES, stockLabel, useInventory } from "@/lib/inventory";
import { clearQueuedRestockUpdates, flushQueuedRestockUpdates, getRestockDigestStatus, syncQueuedRestockUpdate } from "@/lib/stock-updates";
import { isRateLimited, sanitizeText } from "@/lib/security";

export const Route = createFileRoute("/admin")({
  component: AdminInventory,
  head: () => ({
    meta: [
      { title: "Inventory Manager | The Divine Within" },
      { name: "description", content: "Manage hoodie stock levels per size for The Divine Within collection." },
      { property: "og:title", content: "Inventory Manager | The Divine Within" },
      { property: "og:description", content: "Manage hoodie stock levels per size for The Divine Within collection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const PRODUCTS = [
  { id: "vayu-zipup", name: "Vayu Essential", type: "Zip-Up" },
  { id: "agni-pullover", name: "Agni Pullover", type: "Pullover" },
];

const ADMIN_SESSION_CONFIG = {
  // useSession requires a 32+ character encryption password
  password: process.env.SESSION_SECRET?.trim() || "tdw-local-dev-secret-change-me-please",
  name: "tdw-admin-session",
  maxAge: 60 * 60 * 8,
  cookie: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
};

const adminSessionCheck = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<{ isAdmin?: boolean }>(ADMIN_SESSION_CONFIG);
  return { authenticated: session.data.isAdmin === true };
});

const adminLogin = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().min(1).max(64),
      password: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const username = sanitizeText(data.username, 64).toLowerCase();
    const password = sanitizeText(data.password, 128);
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";

    if (isRateLimited(`admin-login:${ip}`, 5, 15 * 60 * 1000)) {
      return { success: false, reason: "rate-limited" };
    }

    const configuredUsername = process.env.ADMIN_USERNAME?.trim() || "admin";
    const configuredPassword = process.env.ADMIN_PASSWORD?.trim() || "Nidhim123!";

    if (username !== configuredUsername.toLowerCase() || password !== configuredPassword) {
      return { success: false, reason: "invalid-credentials" };
    }

    const session = await useSession<{ isAdmin?: boolean }>(ADMIN_SESSION_CONFIG);
    await session.update({ isAdmin: true });
    return { success: true };
  });

const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<{ isAdmin?: boolean }>(ADMIN_SESSION_CONFIG);
  await session.clear();
  return { success: true };
});

const sendRestockNotification = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productName: z.string().min(1),
      size: z.string().min(1),
      previousQty: z.number().int().min(0),
      newQty: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }) => {
    return syncQueuedRestockUpdate(data);
  });

const confirmRestockNotification = createServerFn({ method: "POST" }).handler(async () => {
  return flushQueuedRestockUpdates();
});

const getRestockStatus = createServerFn({ method: "GET" }).handler(async () => {
  return getRestockDigestStatus();
});

const clearRestockQueue = createServerFn({ method: "POST" }).handler(async () => {
  return clearQueuedRestockUpdates();
});

function AdminInventory() {
  const { inventory, hydrated, setStock, reset } = useInventory();
  const checkSession = useServerFn(adminSessionCheck);
  const login = useServerFn(adminLogin);
  const logout = useServerFn(adminLogout);
  const notifyRestock = useServerFn(sendRestockNotification);
  const confirmRestock = useServerFn(confirmRestockNotification);
  const fetchRestockStatus = useServerFn(getRestockStatus);
  const clearQueue = useServerFn(clearRestockQueue);
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [restockMessage, setRestockMessage] = useState("");
  const [queuedRestockCount, setQueuedRestockCount] = useState(0);
  const [isConfirmingRestock, setIsConfirmingRestock] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);

  const refreshRestockStatus = async () => {
    try {
      const status = await fetchRestockStatus();
      if (typeof status?.queuedCount === "number") {
        setQueuedRestockCount(status.queuedCount);
      }
      if (typeof status?.subscriberCount === "number") {
        setSubscriberCount(status.subscriberCount);
      }
    } catch (statusError) {
      console.error("Could not refresh restock status:", statusError);
    }
  };

  useEffect(() => {
    const verifySession = async () => {
      const result = await checkSession();
      setIsAuthenticated(Boolean(result.authenticated));
    };

    void verifySession();
  }, [checkSession]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshRestockStatus();
  }, [isAuthenticated]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = await login({
      data: {
        username: sanitizeText(credentials.username, 64),
        password: sanitizeText(credentials.password, 128),
      },
    });

    if (result?.success) {
      setIsAuthenticated(true);
      setError("");
      return;
    }

    if (result?.reason === "rate-limited") {
      setError("Too many attempts. Please wait 15 minutes before trying again.");
      return;
    }

    setError("Incorrect username or password.");
  };

  const handleLogout = async () => {
    await logout();
    setIsAuthenticated(false);
    setCredentials({ username: "", password: "" });
    setError("");
  };

  const handleStockUpdate = async (productId: string, productName: string, size: string, nextQtyRaw: number) => {
    const nextQty = Number.isFinite(nextQtyRaw) ? Math.max(0, Math.floor(nextQtyRaw)) : 0;
    const previousQty = inventory[productId]?.[size] ?? 0;

    setStock(productId, size as never, nextQty);

    try {
      const result = await notifyRestock({
        data: {
          productName,
          size,
          previousQty,
          newQty: nextQty,
        },
      });

      if (result?.success && typeof result.queuedCount === "number") {
        setQueuedRestockCount(result.queuedCount);
        setRestockMessage(
          result.queuedCount > 0
            ? `Restock queued. ${result.queuedCount} item${result.queuedCount === 1 ? "" : "s"} waiting for confirmation email.`
            : "No restock changes are currently queued.",
        );
        await refreshRestockStatus();
      }
    } catch (notifyError) {
      console.error("Restock notification failed:", notifyError);
      setRestockMessage("Stock updated, but we could not sync queued restock changes.");
    }
  };

  const handleConfirmStock = async () => {
    setIsConfirmingRestock(true);

    try {
      const result = await confirmRestock();
      if (result?.success) {
        if (result.reason === "sent-fallback") {
          setRestockMessage("Combined stock email sent to your store inbox fallback (no subscriber list was available in memory).");
          setQueuedRestockCount(0);
        } else if (typeof result.sentCount === "number" && result.sentCount > 0) {
          setRestockMessage(`Combined stock email sent to ${result.sentCount} subscriber${result.sentCount === 1 ? "" : "s"}.`);
          setQueuedRestockCount(0);
        } else if (result.reason === "no-subscribers") {
          setRestockMessage("No subscribers are currently saved, so no email was sent. Have them subscribe again, then confirm stock.");
          setQueuedRestockCount(0);
        } else if (result.reason === "no-updates") {
          setRestockMessage("No queued stock updates to send right now.");
          setQueuedRestockCount(0);
        } else {
          setRestockMessage("Stock confirmation completed.");
          setQueuedRestockCount(0);
        }
      } else if (result?.reason === "missing-smtp-config") {
        setRestockMessage("Email was not sent because SMTP is not configured. Queue was kept so you can retry.");
      } else if (result?.reason === "send-failed") {
        setRestockMessage("Email send failed. Queue was kept so you can retry Confirm Stock.");
      } else if (result?.reason === "already-sending") {
        setRestockMessage("A stock email is already being sent. Please wait and try again.");
      }
      await refreshRestockStatus();
    } catch (confirmError) {
      console.error("Confirm stock email failed:", confirmError);
      setRestockMessage("Could not send the confirmation stock email. Please try again.");
    } finally {
      setIsConfirmingRestock(false);
    }
  };

  const handleResetStock = async () => {
    try {
      await clearQueue();
      reset();
      await refreshRestockStatus();
      setRestockMessage("Stock and queued updates were reset.");
    } catch (resetError) {
      console.error("Reset stock failed:", resetError);
      setRestockMessage("Could not fully reset queue and stock. Please try again.");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-brand-black text-brand-white font-sans flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md border border-white/10 bg-brand-grey p-8">
          <p className="text-brand-red text-xs font-bold uppercase tracking-widest mb-4">Admin access</p>
          <h1 className="text-4xl font-display font-extrabold uppercase tracking-tighter mb-6">Login</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your admin username and password to manage inventory.
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={credentials.username}
                onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
                className="w-full bg-brand-black border border-white/10 px-4 py-3 text-brand-white outline-none focus:border-brand-red"
                placeholder="admin"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={credentials.password}
                onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
                className="w-full bg-brand-black border border-white/10 px-4 py-3 text-brand-white outline-none focus:border-brand-red"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-brand-red">{error}</p>}

            <div className="rounded border border-brand-red/40 bg-brand-red/10 px-3 py-2 text-xs uppercase tracking-widest text-brand-red">
              Use your configured admin credentials.
            </div>

            <button
              type="submit"
              className="w-full bg-brand-red px-5 py-3 text-xs font-bold uppercase tracking-widest text-brand-white hover:bg-brand-white hover:text-brand-black transition-colors"
            >
              Sign in
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/" className="text-sm text-muted-foreground hover:text-brand-white transition-colors">
              Back to store
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black text-brand-white font-sans px-6 md:px-12 py-16">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12 border-b border-white/10 pb-8">
        <div>
          <p className="text-brand-red text-xs font-bold uppercase tracking-widest mb-3">Back office</p>
          <h1 className="text-4xl md:text-6xl font-display font-extrabold uppercase tracking-tighter">
            Inventory
          </h1>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => void handleResetStock()}
            className="px-6 py-3 border border-white/20 text-xs font-bold uppercase tracking-widest hover:border-brand-red hover:text-brand-red transition-colors"
          >
            Reset stock
          </button>
          <button
            onClick={() => void handleConfirmStock()}
            disabled={isConfirmingRestock || queuedRestockCount === 0}
            className="px-6 py-3 border border-brand-red/60 text-xs font-bold uppercase tracking-widest text-brand-red hover:bg-brand-red hover:text-brand-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isConfirmingRestock ? "Sending..." : queuedRestockCount > 0 ? `Confirm Stock (${queuedRestockCount})` : "Confirm Stock"}
          </button>
          <button
            onClick={handleLogout}
            className="px-6 py-3 border border-white/20 text-xs font-bold uppercase tracking-widest hover:border-brand-red hover:text-brand-red transition-colors"
          >
            Log out
          </button>
          <Link
            to="/"
            className="px-6 py-3 bg-brand-white text-brand-black text-xs font-bold uppercase tracking-widest hover:bg-brand-red hover:text-brand-white transition-colors"
          >
            View store
          </Link>
        </div>
      </header>

      <p className="text-muted-foreground max-w-xl mb-12">
        Update the units available for each size. Anything below 5 units shows a red
        “Only — left in stock” alert on the storefront; zero marks the size sold out.
      </p>

      <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
        Subscribers loaded: {subscriberCount} · Queued restocks: {queuedRestockCount}
      </p>

      {restockMessage && (
        <p className="mb-8 text-xs uppercase tracking-widest text-brand-red">
          {restockMessage}
        </p>
      )}

      <div className="space-y-12">
        {PRODUCTS.map((product) => (
          <section key={product.id}>
            <div className="flex items-baseline gap-4 mb-6">
              <h2 className="text-2xl font-display font-extrabold uppercase">{product.name}</h2>
              <span className="text-xs uppercase tracking-widest text-brand-red">{product.type}</span>
              <span className="text-xs uppercase tracking-widest text-muted-foreground ml-auto">
                {hydrated
                  ? `${SIZES.reduce((sum, s) => sum + (inventory[product.id]?.[s] ?? 0), 0)} units total`
                  : "—"}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {SIZES.map((size) => {
                const qty = inventory[product.id]?.[size] ?? 0;
                const status = stockLabel(qty);
                return (
                  <div key={size} className="border border-white/10 bg-brand-grey/40 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-display font-extrabold text-xl uppercase">{size}</span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-widest ${
                          status.tone === "low"
                            ? "text-brand-red"
                            : status.tone === "out"
                              ? "text-muted-foreground"
                              : "text-brand-white/60"
                        }`}
                      >
                        {status.text}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleStockUpdate(product.id, product.name, size, qty - 1)}
                        className="size-10 border border-white/20 hover:border-brand-red hover:text-brand-red transition-colors"
                        aria-label={`Decrease ${product.name} size ${size} stock`}
                      >
                        −
                      </button>
                      <label className="sr-only" htmlFor={`${product.id}-${size}`}>
                        {product.name} size {size} stock
                      </label>
                      <input
                        id={`${product.id}-${size}`}
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => void handleStockUpdate(product.id, product.name, size, Number(e.target.value))}
                        className="w-full bg-transparent border border-white/20 py-2 text-center font-display font-extrabold text-lg outline-none focus:border-brand-red transition-colors"
                      />
                      <button
                        onClick={() => void handleStockUpdate(product.id, product.name, size, qty + 1)}
                        className="size-10 border border-white/20 hover:border-brand-red hover:text-brand-red transition-colors"
                        aria-label={`Increase ${product.name} size ${size} stock`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
