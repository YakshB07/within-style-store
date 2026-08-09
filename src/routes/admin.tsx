import { createFileRoute, Link } from "@tanstack/react-router";
import { SIZES, stockLabel, useInventory } from "@/lib/inventory";

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

function AdminInventory() {
  const { inventory, hydrated, setStock, reset } = useInventory();

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
            onClick={reset}
            className="px-6 py-3 border border-white/20 text-xs font-bold uppercase tracking-widest hover:border-brand-red hover:text-brand-red transition-colors"
          >
            Reset stock
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
                        onClick={() => setStock(product.id, size, qty - 1)}
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
                        onChange={(e) => setStock(product.id, size, Number(e.target.value))}
                        className="w-full bg-transparent border border-white/20 py-2 text-center font-display font-extrabold text-lg outline-none focus:border-brand-red transition-colors"
                      />
                      <button
                        onClick={() => setStock(product.id, size, qty + 1)}
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
