import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SIZES, stockLabel, useInventory, type Size } from "@/lib/inventory";
import heroHoodie from "@/assets/hero-hoodie.jpg";
import zipupHoodie from "@/assets/zipup-hoodie.jpg";
import pulloverHoodie from "@/assets/pullover-hoodie.jpg";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "The Divine Within | Hindu Cultural Streetwear" },
      { name: "description", content: "Premium unisex hoodies rooted in Hindu culture. Shop the Vayu Zip-Up and Agni Pullover." },
      { property: "og:title", content: "The Divine Within | Hindu Cultural Streetwear" },
      { property: "og:description", content: "Premium unisex hoodies rooted in Hindu culture. Shop the Vayu Zip-Up and Agni Pullover." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const products = [
  {
    id: "vayu-zipup",
    name: "Vayu Essential",
    type: "Zip-Up",
    price: 120,
    description: "Heavyweight 450GSM Organic Cotton",
    image: zipupHoodie,
    imageAlt: "Black Vayu zip-up hoodie with red accents",
    tagColor: "bg-brand-white text-brand-black",
  },
  {
    id: "agni-pullover",
    name: "Agni Pullover",
    type: "Pullover",
    price: 110,
    description: "Oversized Fit, Embroidered Mantra",
    image: pulloverHoodie,
    imageAlt: "Black Agni pullover hoodie with red Hindu mantra embroidery",
    tagColor: "bg-brand-red text-brand-white",
  },
];

function Index() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cart, setCart] = useState<{ id: string; size: string; name: string }[]>([]);
  const { inventory, decrementStock } = useInventory();
  const [selectedSizes, setSelectedSizes] = useState<Record<string, Size>>({
    "vayu-zipup": "M",
    "agni-pullover": "L",
  });
  const [addedPulse, setAddedPulse] = useState<string | null>(null);

  const addToCart = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const size = selectedSizes[productId] ?? "M";
    if ((inventory[productId]?.[size] ?? 0) <= 0) return;
    decrementStock(productId, size);
    setCart((prev) => [...prev, { id: productId, size, name: product.name }]);
    setAddedPulse(productId);
    setTimeout(() => setAddedPulse(null), 900);
  };

  const setSize = (productId: string, size: Size) => {
    setSelectedSizes((prev) => ({ ...prev, [productId]: size }));
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setMobileMenuOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-black text-brand-white font-sans selection:bg-brand-red selection:text-brand-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-brand-black/90 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between px-6 py-6 md:px-12">
          <div className="text-2xl font-display font-extrabold tracking-tighter uppercase">
            The Divine Within
          </div>

          <div className="hidden md:flex items-center space-x-8 text-xs font-medium uppercase tracking-widest">
            <button
              onClick={() => scrollToSection("collection")}
              className="hover:text-brand-red transition-colors"
            >
              The Collection
            </button>
            <button
              onClick={() => scrollToSection("philosophy")}
              className="hover:text-brand-red transition-colors"
            >
              Philosophy
            </button>
            <button className="hover:text-brand-red transition-colors">
              Cart ({cart.length})
            </button>
          </div>

          <button
            className="md:hidden flex flex-col justify-center gap-1.5 w-8 h-8"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className="block h-px bg-brand-white w-full transition-transform duration-300" />
            <span className="block h-px bg-brand-white w-full transition-opacity duration-300" />
            <span className="block h-px bg-brand-white w-full transition-transform duration-300" />
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-brand-black px-6 pb-6">
            <div className="flex flex-col space-y-4 pt-6 text-xs font-medium uppercase tracking-widest">
              <button
                onClick={() => scrollToSection("collection")}
                className="text-left hover:text-brand-red transition-colors"
              >
                The Collection
              </button>
              <button
                onClick={() => scrollToSection("philosophy")}
                className="text-left hover:text-brand-red transition-colors"
              >
                Philosophy
              </button>
              <button className="text-left hover:text-brand-red transition-colors">
                Cart ({cart.length})
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative px-6 md:px-12 pt-32 md:pt-40 pb-16 md:pb-24 grid md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-7 z-10">
          <h1 className="text-6xl md:text-8xl lg:text-9xl font-display font-extrabold uppercase leading-[0.85] tracking-tighter mb-8">
            Awaken{" "}
            <span className="text-brand-red italic">Your</span>
            <br />
            Dharma.
          </h1>
          <p className="max-w-md text-lg md:text-xl leading-relaxed mb-10 text-muted-foreground">
            Contemporary unisex silhouettes meeting ancient Vedic consciousness. One soul, two forms.
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => scrollToSection("collection")}
              className="px-8 py-4 bg-brand-red text-brand-white font-display font-extrabold uppercase tracking-wider hover:bg-brand-white hover:text-brand-black transition-all duration-300"
            >
              Shop Collection
            </button>
          </div>
        </div>
        <div className="md:col-span-5 relative">
          <div className="w-full aspect-[4/5] bg-brand-grey overflow-hidden ring-1 ring-white/5">
            <img
              src={heroHoodie}
              alt="Stoic young man wearing the black Dharma hoodie with a red Om emblem"
              width={1024}
              height={1536}
              className="w-full h-full object-cover"
              loading="eager"
              fetchPriority="high"
            />
          </div>
          <div className="absolute -bottom-6 -left-6 md:-left-12 bg-brand-red px-6 py-4 hidden md:block">
            <span className="font-display font-extrabold uppercase text-2xl text-brand-white">New Drop</span>
          </div>
        </div>
      </section>

      {/* The Duo Selection */}
      <section id="collection" className="px-6 md:px-12 py-24 border-t border-white/10">
        <div className="flex flex-col md:flex-row justify-between items-baseline mb-16 gap-4">
          <h2 className="text-4xl md:text-5xl font-display font-extrabold uppercase">The Core Duo</h2>
          <p className="text-brand-red font-medium uppercase tracking-widest text-sm">Limited Release 001</p>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          {products.map((product) => (
            <div key={product.id} className="group">
              <div className="relative overflow-hidden mb-6">
                <div className="w-full aspect-[3/4] bg-brand-grey overflow-hidden ring-1 ring-white/5">
                  <img
                    src={product.image}
                    alt={product.imageAlt}
                    width={1024}
                    height={1232}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
                <div className={`absolute top-4 left-4 px-3 py-1 text-xs font-bold uppercase ${product.tagColor}`}>
                  {product.type}
                </div>
              </div>

              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-display font-extrabold uppercase mb-1">{product.name}</h3>
                  <p className="text-muted-foreground text-sm">{product.description}</p>
                </div>
                <span className="text-xl font-display font-extrabold">${product.price}</span>
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2">
                  {["S", "M", "L", "XL"].map((size) => (
                    <button
                      key={size}
                      onClick={() => setSize(product.id, size)}
                      className={`size-10 flex items-center justify-center text-xs font-bold uppercase transition-all border ${
                        selectedSizes[product.id] === size
                          ? "bg-brand-white text-brand-black border-brand-white"
                          : "bg-transparent text-brand-white border-white/20 hover:border-brand-white"
                      }`}
                      aria-label={`Select size ${size}`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => addToCart(product.id)}
                className={`w-full py-4 font-display font-extrabold uppercase tracking-wider transition-all duration-300 ${
                  addedPulse === product.id
                    ? "bg-brand-red text-brand-white"
                    : "bg-brand-white text-brand-black hover:bg-brand-red hover:text-brand-white"
                }`}
              >
                {addedPulse === product.id ? "Added to Bag" : "Add to Bag"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Philosophy */}
      <section id="philosophy" className="px-6 md:px-12 py-24 border-t border-white/10 bg-brand-grey">
        <div className="max-w-4xl">
          <p className="text-brand-red font-medium uppercase tracking-widest text-sm mb-6">Philosophy</p>
          <h2 className="text-4xl md:text-6xl font-display font-extrabold uppercase tracking-tight leading-[0.95] mb-8">
            The Temple is a Body.<br />The Body is a Temple.
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
            The Divine Within explores the intersection of ancient Vedic principles and contemporary street culture. Each garment is a vessel for self-realization, featuring subtle details inspired by sacred geometry and Hindu iconography. Every piece is ethically sourced, made for seekers aged 15-30 who carry tradition forward without saying a word.
          </p>
        </div>
      </section>

      {/* Payment & Footer */}
      <footer className="bg-brand-black px-6 md:px-12 py-16 border-t border-white/10">
        <div className="grid md:grid-cols-3 gap-12 border-b border-white/5 pb-12 mb-12">
          <div>
            <div className="text-xl font-display font-extrabold uppercase mb-6">The Divine Within</div>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              Bridging the gap between sacred geometry and modern streetwear. Ethically sourced, spiritually inspired.
            </p>
          </div>
          <div className="flex flex-col space-y-4">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-red">Quick Links</span>
            <button onClick={() => scrollToSection("collection")} className="text-muted-foreground hover:text-brand-white transition-colors text-left">
              The Collection
            </button>
            <button onClick={() => scrollToSection("philosophy")} className="text-muted-foreground hover:text-brand-white transition-colors text-left">
              Philosophy
            </button>
            <a href="mailto:hello@thedivinewithin.com" className="text-muted-foreground hover:text-brand-white transition-colors">
              Contact Us
            </a>
          </div>
          <div className="flex flex-col space-y-6">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-red">Secure Checkout</span>
            <div className="flex gap-4 items-center">
              <div className="h-8 w-12 bg-white/10 rounded border border-white/10 flex items-center justify-center">
                <span className="text-[8px] font-bold text-brand-white uppercase">Visa</span>
              </div>
              <div className="h-8 w-12 bg-white/10 rounded border border-white/10 flex items-center justify-center">
                <span className="text-[8px] font-bold text-brand-white uppercase"> Pay</span>
              </div>
            </div>
            <div className="pt-4">
              <form className="flex border-b border-white/20" onSubmit={(e) => e.preventDefault()}>
                <input
                  type="email"
                  placeholder="Join the tribe (Email)"
                  className="bg-transparent py-2 text-sm w-full outline-none focus:placeholder-transparent transition-all text-brand-white placeholder:text-muted-foreground"
                />
                <button type="submit" className="text-brand-red font-bold text-xl">→</button>
              </form>
            </div>
          </div>
        </div>
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-widest">
          <p>© 2024 The Divine Within. All rights reserved.</p>
          <p>Made for the seekers.</p>
        </div>
      </footer>
    </div>
  );
}
