import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import nodemailer from "nodemailer";
import { SIZES, stockLabel, useInventory, type Size } from "@/lib/inventory";
import { addStockSubscriber, sendSubscriptionConfirmationEmail } from "@/lib/stock-updates";
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
    normalPrice: 110,
    salePrice: 80,
    description: "Heavyweight 450GSM Organic Cotton",
    image: zipupHoodie,
    imageAlt: "Black Vayu zip-up hoodie with red accents",
    tagColor: "bg-brand-white text-brand-black",
  },
  {
    id: "agni-pullover",
    name: "Agni Pullover",
    type: "Pullover",
    normalPrice: 100,
    salePrice: 70,
    description: "Oversized Fit, Embroidered Mantra",
    image: pulloverHoodie,
    imageAlt: "Black Agni pullover hoodie with red Hindu mantra embroidery",
    tagColor: "bg-brand-red text-brand-white",
  },
];

const ORDERS_STORAGE_KEY = "tdw-orders-v1";
const PICKUP_LOCATION = {
  name: "Lambton Hall, Western University",
  addressLine1: "40 University Dr",
  city: "London",
  province: "Ontario",
  postalCode: "N6A 3K7",
  country: "Canada",
};

const canadaProvinces = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
];

const CANADIAN_POSTAL_REGEX = /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/;
const SHIPPING_RATES: Record<string, number> = {
  ON: 11,
  QC: 14,
  NB: 17,
  NS: 18,
  PE: 19,
  MB: 18,
  SK: 20,
  AB: 22,
  BC: 24,
  YT: 35,
  NT: 38,
  NU: 45,
};
const PROVINCE_CODE_MAP: Record<string, string> = {
  Alberta: "AB",
  "British Columbia": "BC",
  Manitoba: "MB",
  "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL",
  "Northwest Territories": "NT",
  "Nova Scotia": "NS",
  Nunavut: "NU",
  Ontario: "ON",
  "Prince Edward Island": "PE",
  Quebec: "QC",
  Saskatchewan: "SK",
  Yukon: "YT",
};
const POSTAL_PREFIX_TO_PROVINCE: Record<string, string[]> = {
  A: ["NL"],
  B: ["NS"],
  C: ["PE"],
  E: ["NB"],
  G: ["QC"],
  H: ["QC"],
  J: ["QC"],
  K: ["ON"],
  L: ["ON"],
  M: ["ON"],
  N: ["ON"],
  P: ["ON"],
  R: ["MB"],
  S: ["SK"],
  T: ["AB"],
  V: ["BC"],
  X: ["NT", "NU"],
  Y: ["YT"],
};

const normalizePostalCode = (postalCode: string) => postalCode.trim().toUpperCase().replace(/\s+/g, " ");

const getProvinceCodeFromPostalCode = (postalCode: string) => {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized || !isValidCanadianPostalCode(normalized)) return null;

  const firstLetter = normalized.charAt(0).toUpperCase();
  return POSTAL_PREFIX_TO_PROVINCE[firstLetter]?.[0] ?? null;
};

const postalMatchesSelectedProvince = (postalCode: string, selectedProvince: string) => {
  if (!selectedProvince) return true;

  const normalizedPostalCode = normalizePostalCode(postalCode);
  if (!isValidCanadianPostalCode(normalizedPostalCode)) return false;

  const selectedProvinceCode = PROVINCE_CODE_MAP[selectedProvince];
  const firstLetter = normalizedPostalCode.charAt(0).toUpperCase();
  const allowedCodes = POSTAL_PREFIX_TO_PROVINCE[firstLetter] ?? [];

  return selectedProvinceCode ? allowedCodes.includes(selectedProvinceCode) : false;
};

const isValidCanadianPostalCode = (value: string) => CANADIAN_POSTAL_REGEX.test(normalizePostalCode(value));
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const isValidPhone = (value: string) => /^\+?[0-9()\-\s]{7,20}$/.test(value.trim());

const createStripePaymentIntent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      amount: z.number(),
      currency: z.string().default("cad"),
      orderId: z.string(),
      email: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const stripeSecretKey = process.env["STRIPE_SECRET_KEY"]?.trim();
      const publishableKey = process.env["VITE_STRIPE_PUBLISHABLE_KEY"]?.trim();

      if (!stripeSecretKey || !publishableKey) {
        return { success: false, reason: "missing-stripe-config" };
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2026-07-29.dahlia",
      });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(data.amount * 100),
        currency: data.currency.toLowerCase(),
        description: `The Divine Within order ${data.orderId}`,
        metadata: {
          orderId: data.orderId,
        },
        ...(data.email ? { receipt_email: data.email } : {}),
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      console.error("createStripePaymentIntent server error:", error);
      return {
        success: false,
        reason: "stripe-create-failed",
        message: error instanceof Error ? error.message : "Unknown Stripe error",
      };
    }
  });

const sendOrderEmail = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      fulfillmentMethod: z.enum(["shipping", "pickup"]),
      customer: z.object({
        firstName: z.string(),
        lastName: z.string(),
        email: z.string(),
        phone: z.string(),
        payment: z.string(),
      }),
      shippingAddress: z.object({
        fullName: z.string(),
        addressLine1: z.string(),
        addressLine2: z.string().optional().or(z.literal("")),
        city: z.string(),
        province: z.string(),
        postalCode: z.string(),
        phone: z.string(),
      }),
      items: z.array(
        z.object({
          name: z.string(),
          size: z.string(),
          price: z.number(),
        }),
      ),
      pickupLocation: z
        .object({
          name: z.string(),
          addressLine1: z.string(),
          city: z.string(),
          province: z.string(),
          postalCode: z.string(),
          country: z.string(),
        })
        .optional(),
      subtotal: z.number(),
      tax: z.number(),
      shippingCost: z.number(),
      total: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const orderLines = data.items
      .map((item) => `- ${item.name} | Size ${item.size} | $${item.price}`)
      .join("\n");

    const shippingAddressText = [
      data.shippingAddress.fullName,
      data.shippingAddress.addressLine1,
      data.shippingAddress.addressLine2 || "",
      `${data.shippingAddress.city}, ${data.shippingAddress.province}`,
      data.shippingAddress.postalCode,
      `Phone: ${data.shippingAddress.phone}`,
    ]
      .filter(Boolean)
      .join("\n");

    const pickupLocationText = data.pickupLocation
      ? [
          data.pickupLocation.name,
          data.pickupLocation.addressLine1,
          `${data.pickupLocation.city}, ${data.pickupLocation.province}`,
          data.pickupLocation.postalCode,
          data.pickupLocation.country,
        ].join("\n")
      : "";

    const text = [
      "Someone sent an order from The Divine Within.",
      "",
      `Order ID: ${data.id}`,
      `First Name: ${data.customer.firstName}`,
      `Last Name: ${data.customer.lastName}`,
      `Email: ${data.customer.email}`,
      `Phone: ${data.customer.phone}`,
      `Fulfillment: ${data.fulfillmentMethod === "pickup" ? "Pickup" : "Shipping"}`,
      data.fulfillmentMethod === "pickup" ? "Pickup Location:" : "Shipping Address:",
      data.fulfillmentMethod === "pickup" ? pickupLocationText : shippingAddressText,
      `Payment Method: ${data.customer.payment}`,
      "",
      "Order Items:",
      orderLines,
      "",
      `Subtotal: $${data.subtotal.toFixed(2)}`,
      `Sales Tax (13%): $${data.tax.toFixed(2)}`,
      `Shipping: $${data.shippingCost.toFixed(2)}`,
      `Total: $${data.total.toFixed(2)}`,
      "",
      "Please prepare this order for fulfillment.",
    ].join("\n");

    const smtpHost = process.env["SMTP_HOST"]?.trim();
    const smtpPort = Number(process.env["SMTP_PORT"] ?? "587");
    const smtpUser = process.env["SMTP_USER"]?.trim();
    const smtpPass = process.env["SMTP_PASS"]?.trim();
    const toAddress = process.env["ORDER_EMAIL_TO"]?.trim() ?? "OPinox007@gmail.com";
    const fromAddress = process.env["SMTP_FROM"]?.trim() ?? smtpUser ?? "no-reply@thedivinewithin.com";

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn("Order email skipped because SMTP environment variables are not configured.");
      return { success: false, reason: "missing-smtp-config" };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      requireTLS: true,
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.verify();
    await transporter.sendMail({
      from: fromAddress,
      to: toAddress,
      replyTo: data.customer.email,
      subject: `New order from ${data.customer.firstName} ${data.customer.lastName}`,
      text,
    });

    return { success: true };
  });

const subscribeToStockUpdates = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const { alreadySubscribed } = addStockSubscriber(normalizedEmail);

    try {
      await sendSubscriptionConfirmationEmail(normalizedEmail);
    } catch (error) {
      console.error("Subscription confirmation email failed:", error);
    }

    return { success: true, alreadySubscribed };
  });

const stripePromise = import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"]
  ? loadStripe(import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"])
  : null;

type CheckoutPaymentFormProps = {
  clientSecret: string;
  onSubmitOrder: () => Promise<void>;
  paymentError: string;
  setPaymentError: (message: string) => void;
};

function CheckoutPaymentForm({ clientSecret, onSubmitOrder, paymentError, setPaymentError }: CheckoutPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!stripe || !elements) {
      setPaymentError("Stripe has not loaded yet. Please wait a moment and try again.");
      return;
    }

    setIsSubmitting(true);
    setPaymentError("");

    try {
      const result = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: window.location.origin,
        },
        redirect: "if_required",
      });

      if (result.error) {
        setPaymentError(result.error.message ?? "Your payment could not be processed. Please try again.");
        return;
      }

      if (result.paymentIntent?.status !== "succeeded") {
        setPaymentError("Payment was not completed. Please try again.");
        return;
      }

      await onSubmitOrder();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-brand-grey/40 p-4">
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card"],
            wallets: {
              applePay: "auto",
            },
          }}
        />
      </div>

      {paymentError && <p className="text-xs text-brand-red">{paymentError}</p>}

      <button
        type="submit"
        disabled={!stripe || !elements || isSubmitting}
        className="w-full bg-brand-red px-5 py-4 text-xs font-bold uppercase tracking-widest text-brand-white hover:bg-brand-white hover:text-brand-black transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Processing..." : "Place Order"}
      </button>
    </form>
  );
}

function Index() {
  const sendEmail = useServerFn(sendOrderEmail);
  const createPaymentIntent = useServerFn(createStripePaymentIntent);
  const subscribe = useServerFn(subscribeToStockUpdates);
  const stripeEnabled = Boolean(import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"]?.trim());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cart, setCart] = useState<{ id: string; size: string; name: string; price: number }[]>([]);
  const [recentOrder, setRecentOrder] = useState<null | {
    id: string;
    fulfillmentMethod: "shipping" | "pickup";
    customer: { firstName: string; lastName: string; email: string; phone: string; payment: string };
    shippingAddress: {
      fullName: string;
      addressLine1: string;
      addressLine2: string;
      city: string;
      province: string;
      postalCode: string;
      phone: string;
    };
    pickupLocation?: {
      name: string;
      addressLine1: string;
      city: string;
      province: string;
      postalCode: string;
      country: string;
    };
    items: { name: string; size: string; price: number }[];
    subtotal: number;
    tax: number;
    shippingCost: number;
    total: number;
    placedAt: string;
  }>(null);
  const { inventory, decrementStock, setStock } = useInventory();
  const [selectedSizes, setSelectedSizes] = useState<Record<string, Size>>({
    "vayu-zipup": "M",
    "agni-pullover": "L",
  });
  const [addedPulse, setAddedPulse] = useState<string | null>(null);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);
  const [checkout, setCheckout] = useState({
    firstName: "",
    lastName: "",
    email: "",
    shippingFullName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    province: "",
    postalCode: "",
    shippingPhone: "",
  });
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"shipping" | "pickup">("shipping");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [shippingCost, setShippingCost] = useState(0);
  const [shippingCostError, setShippingCostError] = useState("");
  const [isCalculatingShippingCost, setIsCalculatingShippingCost] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [isPreparingPayment, setIsPreparingPayment] = useState(false);
  const [subscriberEmail, setSubscriberEmail] = useState("");
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribeStatus, setSubscribeStatus] = useState("");
  const [subscribeError, setSubscribeError] = useState("");
  const paymentShippingSnapshotRef = useRef<{ method: "shipping" | "pickup"; postalCode: string; province: string } | null>(null);

  const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
  const tax = subtotal * 0.13;
  const effectiveShippingCost = fulfillmentMethod === "pickup" ? 0 : shippingCost;
  const total = subtotal + tax + effectiveShippingCost;

  useEffect(() => {
    if (fulfillmentMethod === "pickup") {
      setShippingCost(0);
      setShippingCostError("");
      setIsCalculatingShippingCost(false);
      return;
    }

    const normalizedPostalCode = normalizePostalCode(checkout.postalCode);

    if (!normalizedPostalCode || !isValidCanadianPostalCode(normalizedPostalCode)) {
      setShippingCost(0);
      setShippingCostError("");
      setIsCalculatingShippingCost(false);
      return;
    }

    if (checkout.province && !postalMatchesSelectedProvince(normalizedPostalCode, checkout.province)) {
      setShippingCost(0);
      setShippingCostError("That postal code does not match the selected province/territory.");
      setIsCalculatingShippingCost(false);
      return;
    }

    const provinceCode = getProvinceCodeFromPostalCode(normalizedPostalCode);
    if (!provinceCode) {
      setShippingCost(0);
      setShippingCostError("We couldn’t recognize that Canadian postal code. Please check it and try again.");
      setIsCalculatingShippingCost(false);
      return;
    }

    const nextShippingCost = Number((SHIPPING_RATES[provinceCode] ?? 0).toFixed(2));
    setShippingCost(nextShippingCost);
    setShippingCostError("");
    setIsCalculatingShippingCost(false);
  }, [checkout.postalCode, checkout.province, fulfillmentMethod]);

  const addToCart = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const size = selectedSizes[productId] ?? "M";
    if ((inventory[productId]?.[size] ?? 0) <= 0) return;
    setCart((prev) => [...prev, { id: productId, size, name: product.name, price: product.salePrice }]);
    setAddedPulse(productId);
    setTimeout(() => setAddedPulse(null), 900);
  };

  const removeFromCart = (index: number) => {
    const item = cart[index];
    if (!item) return;

    setCart((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleCheckoutChange = (field: keyof typeof checkout, value: string) => {
    setCheckout((prev) => ({ ...prev, [field]: value }));

    if (field === "postalCode" || field === "province") {
      setShippingCostError("");
      setIsCalculatingShippingCost(Boolean(value));
    }
  };

  const firstNameError = submitAttempted && !checkout.firstName.trim() ? "Please fill out this field." : "";
  const lastNameError = submitAttempted && !checkout.lastName.trim() ? "Please fill out this field." : "";
  const emailError = submitAttempted
    ? !checkout.email.trim()
      ? "Please fill out this field."
      : !isValidEmail(checkout.email)
        ? "Please enter a valid email address."
        : ""
    : "";
  const shippingFullNameError = submitAttempted && !checkout.shippingFullName.trim() ? "Please fill out this field." : "";
  const addressLine1Error = submitAttempted && fulfillmentMethod === "shipping" && !checkout.addressLine1.trim() ? "Please fill out this field." : "";
  const cityError = submitAttempted && fulfillmentMethod === "shipping" && !checkout.city.trim() ? "Please fill out this field." : "";
  const provinceError = submitAttempted && fulfillmentMethod === "shipping" && !checkout.province.trim() ? "Please fill out this field." : "";
  const shippingPhoneError = submitAttempted
    ? !checkout.shippingPhone.trim()
      ? "Please fill out this field."
      : !isValidPhone(checkout.shippingPhone)
        ? "Please enter a valid phone number."
        : ""
    : "";
  const postalCodeError = submitAttempted
    ? fulfillmentMethod !== "shipping"
      ? ""
      : !checkout.postalCode.trim()
      ? "Please fill out this field."
      : !isValidCanadianPostalCode(checkout.postalCode)
        ? "Please enter a valid Canadian postal code format (A1A 1A1)."
        : ""
    : "";

  useEffect(() => {
    if (!clientSecret || !paymentShippingSnapshotRef.current) return;

    const snapshot = paymentShippingSnapshotRef.current;
    const methodChanged = fulfillmentMethod !== snapshot.method;
    const currentPostal = normalizePostalCode(checkout.postalCode);
    const provinceChanged = checkout.province.trim() !== snapshot.province;
    const postalChanged = currentPostal !== snapshot.postalCode;

    if (methodChanged || postalChanged || provinceChanged) {
      setClientSecret(null);
      setOrderId(null);
      paymentShippingSnapshotRef.current = null;
      setPaymentError("");
    }
  }, [checkout.postalCode, checkout.province, fulfillmentMethod, clientSecret]);

  const handlePlaceOrder = async () => {
    if (!cart.length) return;
    if (!orderId) {
      setPaymentError("A valid order ID was not created. Please try again.");
      return;
    }

    const normalizedPostalCode = normalizePostalCode(checkout.postalCode);
    const isPickup = fulfillmentMethod === "pickup";
    const orderRecord = {
      id: orderId,
      fulfillmentMethod,
      customer: {
        firstName: checkout.firstName.trim(),
        lastName: checkout.lastName.trim(),
        email: checkout.email.trim(),
        phone: checkout.shippingPhone.trim(),
        payment: "Card",
      },
      shippingAddress: {
        fullName: checkout.shippingFullName.trim(),
        addressLine1: isPickup ? PICKUP_LOCATION.addressLine1 : checkout.addressLine1.trim(),
        addressLine2: isPickup ? PICKUP_LOCATION.name : checkout.addressLine2.trim(),
        city: isPickup ? PICKUP_LOCATION.city : checkout.city.trim(),
        province: isPickup ? PICKUP_LOCATION.province : checkout.province,
        postalCode: isPickup ? PICKUP_LOCATION.postalCode : normalizedPostalCode,
        phone: checkout.shippingPhone.trim(),
      },
      ...(isPickup ? { pickupLocation: PICKUP_LOCATION } : {}),
      items: cart.map((item) => ({ name: item.name, size: item.size, price: item.price })),
      subtotal,
      tax,
      shippingCost: effectiveShippingCost,
      total,
      placedAt: new Date().toISOString(),
    };

    setIsProcessingOrder(true);

    try {
      try {
        const savedOrdersRaw = localStorage.getItem(ORDERS_STORAGE_KEY);
        const savedOrders = savedOrdersRaw ? JSON.parse(savedOrdersRaw) : [];
        const nextOrders = Array.isArray(savedOrders) ? [orderRecord, ...savedOrders] : [orderRecord];
        localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(nextOrders.slice(0, 50)));
      } catch {
        // ignore local storage errors and continue with the backend email attempt
      }

      const groupedByProduct = cart.reduce<Record<string, Record<string, number>>>((acc, item) => {
        const productId = item.id;
        const size = item.size;
        acc[productId] ??= {};
        acc[productId][size] = (acc[productId][size] ?? 0) + 1;
        return acc;
      }, {});

      Object.entries(groupedByProduct).forEach(([productId, sizes]) => {
        Object.entries(sizes).forEach(([size, qty]) => {
          const currentQty = inventory[productId]?.[size as Size] ?? 0;
          setStock(productId, size as Size, Math.max(0, currentQty - qty));
        });
      });

      try {
        const result = await sendEmail({ data: orderRecord });
        if (result?.success === false && result?.reason === "missing-smtp-config") {
          console.warn("Order email skipped because SMTP environment variables are not configured.");
        }
      } catch (error) {
        console.error("Order email failed:", error);
      }

      setRecentOrder(orderRecord);
      setCart([]);
      setCheckout({
        firstName: "",
        lastName: "",
        email: "",
        shippingFullName: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        province: "",
        postalCode: "",
        shippingPhone: "",
      });
      setShippingCost(0);
      setShippingCostError("");
      setClientSecret(null);
      setOrderId(null);
      paymentShippingSnapshotRef.current = null;
      setPaymentError("");
    } finally {
      setIsProcessingOrder(false);
    }
  };

  const handlePreparePayment = async (event: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
    console.log("handlePreparePayment invoked", { eventType: event.type, cartLength: cart.length, checkout });
    event.preventDefault();
    setSubmitAttempted(true);

    if (!cart.length) return;

    const requiredFields = [
      checkout.firstName,
      checkout.lastName,
      checkout.email,
      checkout.shippingFullName,
      checkout.shippingPhone,
    ];

    if (fulfillmentMethod === "shipping") {
      requiredFields.push(checkout.addressLine1, checkout.city, checkout.province, checkout.postalCode);
    }

    if (requiredFields.some((field) => !field.trim())) {
      setShippingCostError("Please fill out all required fields above before placing the order.");
      return;
    }

    if (!isValidEmail(checkout.email) || !isValidPhone(checkout.shippingPhone)) {
      return;
    }

    if (fulfillmentMethod === "shipping" && !isValidCanadianPostalCode(checkout.postalCode)) {
      return;
    }

    if (fulfillmentMethod === "shipping" && (shippingCostError || !shippingCost)) {
      setShippingCostError("Please enter a valid Canadian postal code to calculate shipping.");
      return;
    }

    if (!stripeEnabled) {
      setPaymentError("Add your Stripe keys in .env to enable live checkout.");
      return;
    }

    setPaymentError("");
    const generatedOrderId = `tdw-${Date.now()}`;
    setOrderId(generatedOrderId);
    setIsPreparingPayment(true);

    try {
      const paymentResult = await createPaymentIntent({
        data: {
          amount: total,
          currency: "cad",
          orderId: generatedOrderId,
          email: checkout.email.trim(),
        },
      });

      console.log("createPaymentIntent resolved:", paymentResult);

      if (paymentResult?.success === false && paymentResult?.reason === "missing-stripe-config") {
        setPaymentError("Stripe is not configured correctly. Please contact support.");
        return;
      }

      if (paymentResult?.success === false && paymentResult?.reason === "stripe-create-failed") {
        setPaymentError(paymentResult.message ?? "Stripe could not create a payment session. Please try again.");
        return;
      }

      if (!paymentResult?.success || !paymentResult.clientSecret) {
        setClientSecret(null);
        setOrderId(null);
        paymentShippingSnapshotRef.current = null;
        setPaymentError("We could not start secure checkout. Please try again.");
        return;
      }

      paymentShippingSnapshotRef.current = {
        method: fulfillmentMethod,
        postalCode: fulfillmentMethod === "shipping" ? normalizePostalCode(checkout.postalCode) : "",
        province: fulfillmentMethod === "shipping" ? checkout.province.trim() : "",
      };
      setClientSecret(paymentResult.clientSecret);
    } catch (error) {
      console.error("handlePreparePayment catch:", error);
      setClientSecret(null);
      setOrderId(null);
      paymentShippingSnapshotRef.current = null;
      setPaymentError("We could not start secure checkout. Please try again.");
    } finally {
      setIsPreparingPayment(false);
    }
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

  const handleStockSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubscribeStatus("");
    setSubscribeError("");
    setIsSubscribed(false);

    if (!isValidEmail(subscriberEmail)) {
      setSubscribeError("Please enter a valid email address.");
      return;
    }

    setIsSubscribing(true);

    try {
      const result = await subscribe({
        data: { email: subscriberEmail.trim() },
      });

      if (result?.success) {
        setSubscribeStatus(
          result.alreadySubscribed
            ? "You are already subscribed for stock updates."
            : "Subscribed. You will get updates when new stock comes in.",
        );
        setIsSubscribed(true);
        setSubscriberEmail("");
      }
    } catch (error) {
      console.error("Subscription failed:", error);
      setSubscribeError("We could not subscribe you right now. Please try again.");
    } finally {
      setIsSubscribing(false);
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
            <button onClick={() => scrollToSection("cart")} className="hover:text-brand-red transition-colors">
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
              <button onClick={() => scrollToSection("cart")} className="text-left hover:text-brand-red transition-colors">
                Cart ({cart.length})
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative px-4 sm:px-6 md:px-12 pt-24 sm:pt-28 md:pt-40 pb-12 sm:pb-16 md:pb-24 grid gap-6 md:grid-cols-12 md:gap-8 md:items-center">
        <div className="md:col-span-7 z-10">
          <h1 className="text-[3.2rem] leading-[0.82] sm:text-[4.25rem] md:text-7xl lg:text-[7rem] xl:text-[8rem] font-display font-extrabold uppercase tracking-tighter mb-4 sm:mb-6 md:mb-8 max-w-[12ch]">
            Awaken{" "}
            <span className="text-brand-red italic">Your</span>
            <br />
            Dharma.
          </h1>
          <p className="max-w-md text-base sm:text-lg md:text-xl leading-relaxed mb-6 sm:mb-8 md:mb-10 text-muted-foreground">
            Contemporary unisex silhouettes meeting ancient Vedic consciousness. One soul, two forms.
          </p>
          <div className="flex flex-wrap gap-3 sm:gap-4">
            <button
              onClick={() => scrollToSection("collection")}
              className="px-5 py-3 sm:px-8 sm:py-4 bg-brand-red text-brand-white font-display font-extrabold uppercase tracking-wider hover:bg-brand-white hover:text-brand-black transition-all duration-300 text-sm sm:text-base"
            >
              Shop Collection
            </button>
          </div>
        </div>
        <div className="md:col-span-5 relative order-first md:order-none">
          <div className="w-full aspect-[4/5] max-w-[30rem] md:max-w-none mx-auto md:mx-0 bg-brand-grey overflow-hidden ring-1 ring-white/5">
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
          <div className="absolute -bottom-6 -left-6 md:-left-12 bg-brand-red px-5 py-3 md:px-6 md:py-4 hidden md:block">
            <span className="font-display font-extrabold uppercase text-xl md:text-2xl text-brand-white">New Drop</span>
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
                <div className="text-right">
                  <span className="block text-xl font-display font-extrabold text-brand-red">${product.salePrice}</span>
                  <span className="block text-sm text-muted-foreground line-through">${product.normalPrice}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2">
                  {SIZES.map((size) => {
                    const qty = inventory[product.id]?.[size] ?? 0;
                    const soldOut = qty <= 0;
                    return (
                      <button
                        key={size}
                        onClick={() => setSize(product.id, size)}
                        disabled={soldOut}
                        className={`size-10 flex items-center justify-center text-xs font-bold uppercase transition-all border relative ${
                          soldOut
                            ? "bg-transparent text-muted-foreground border-white/10 cursor-not-allowed line-through"
                            : selectedSizes[product.id] === size
                              ? "bg-brand-white text-brand-black border-brand-white"
                              : "bg-transparent text-brand-white border-white/20 hover:border-brand-white"
                        }`}
                        aria-label={soldOut ? `Size ${size} sold out` : `Select size ${size}`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(() => {
                const size = selectedSizes[product.id] ?? "M";
                const status = stockLabel(inventory[product.id]?.[size] ?? 0);
                return (
                  <p
                    className={`mb-4 text-xs font-bold uppercase tracking-widest ${
                      status.tone === "low"
                        ? "text-brand-red animate-pulse"
                        : status.tone === "out"
                          ? "text-muted-foreground"
                          : "text-brand-white/70"
                    }`}
                    aria-live="polite"
                  >
                    {status.tone === "low" && <span className="mr-2">●</span>}
                    {status.text}
                    {status.tone !== "out" && <span className="text-muted-foreground"> · Size {size}</span>}
                  </p>
                );
              })()}

              <button
                onClick={() => addToCart(product.id)}
                disabled={(inventory[product.id]?.[selectedSizes[product.id] ?? "M"] ?? 0) <= 0}
                className={`w-full py-4 font-display font-extrabold uppercase tracking-wider transition-all duration-300 ${
                  (inventory[product.id]?.[selectedSizes[product.id] ?? "M"] ?? 0) <= 0
                    ? "bg-brand-grey text-muted-foreground cursor-not-allowed"
                    : addedPulse === product.id
                    ? "bg-brand-red text-brand-white"
                    : "bg-brand-white text-brand-black hover:bg-brand-red hover:text-brand-white"
                }`}
              >
                {(inventory[product.id]?.[selectedSizes[product.id] ?? "M"] ?? 0) <= 0
                  ? "Sold Out"
                  : addedPulse === product.id
                    ? "Added to Bag"
                    : "Add to Bag"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="cart" className="px-6 md:px-12 py-24 border-t border-white/10 bg-brand-grey">
        {isProcessingOrder ? (
          <div className="max-w-xl mx-auto border border-brand-red/30 bg-brand-black/50 p-10 md:p-16 text-center">
            <div className="mx-auto mb-6 h-14 w-14 animate-spin rounded-full border-2 border-brand-white/20 border-t-brand-red" aria-label="Processing order" />
            <p className="text-brand-red text-xs font-bold uppercase tracking-widest mb-4">Processing order</p>
            <h2 className="text-3xl md:text-4xl font-display font-extrabold uppercase mb-3">Preparing your order</h2>
            <p className="text-muted-foreground">Please hold while we secure your purchase and finalize the details.</p>
          </div>
        ) : recentOrder ? (
          <div className="max-w-3xl mx-auto border border-brand-red/30 bg-brand-black/50 p-8 md:p-12 text-center">
            <p className="text-brand-red text-xs font-bold uppercase tracking-widest mb-4">Order confirmed</p>
            <h2 className="text-4xl md:text-5xl font-display font-extrabold uppercase mb-4">
              Thank you, {recentOrder.customer.firstName}!
            </h2>
            <p className="text-muted-foreground mb-8">
              {recentOrder.fulfillmentMethod === "pickup"
                ? "Your order has been received. We will contact you when your order is ready for pickup."
                : "Your order has been received and is being prepared for fulfillment."}
            </p>

            <div className="grid md:grid-cols-2 gap-6 text-left mb-10">
              <div className="border border-white/10 bg-brand-black/40 p-5">
                <p className="text-[10px] uppercase tracking-widest text-brand-red mb-2">Order ID</p>
                <p className="font-display font-extrabold uppercase text-xl">{recentOrder.id}</p>
              </div>
              <div className="border border-white/10 bg-brand-black/40 p-5">
                <p className="text-[10px] uppercase tracking-widest text-brand-red mb-2">Total</p>
                <p className="font-display font-extrabold uppercase text-xl">${recentOrder.total.toFixed(2)}</p>
              </div>
            </div>

            <div className="border border-white/10 bg-brand-black/40 p-5 text-left mb-8">
              <p className="text-[10px] uppercase tracking-widest text-brand-red mb-3">Items</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {recentOrder.items.map((item, index) => (
                  <li key={`${item.name}-${item.size}-${index}`}>
                    {item.name} · Size {item.size} · ${item.price}
                  </li>
                ))}
              </ul>
            </div>

            {recentOrder.fulfillmentMethod === "pickup" && recentOrder.pickupLocation && (
              <div className="border border-white/10 bg-brand-black/40 p-5 text-left mb-8">
                <p className="text-[10px] uppercase tracking-widest text-brand-red mb-3">Pickup Location</p>
                <p className="text-sm text-brand-white font-semibold">{recentOrder.pickupLocation.name}</p>
                <p className="text-sm text-muted-foreground">{recentOrder.pickupLocation.addressLine1}</p>
                <p className="text-sm text-muted-foreground">
                  {recentOrder.pickupLocation.city}, {recentOrder.pickupLocation.province} {recentOrder.pickupLocation.postalCode}
                </p>
                <p className="text-sm text-muted-foreground">{recentOrder.pickupLocation.country}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setRecentOrder(null)}
              className="bg-brand-red px-6 py-3 text-xs font-bold uppercase tracking-widest text-brand-white hover:bg-brand-white hover:text-brand-black transition-colors"
            >
              Continue Shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-4">
              <div>
                <p className="text-brand-red font-medium uppercase tracking-widest text-sm mb-4">Shopping bag</p>
                <h2 className="text-4xl md:text-5xl font-display font-extrabold uppercase">Your Cart</h2>
              </div>
              <div className="text-sm uppercase tracking-widest text-muted-foreground">{cart.length} item{cart.length === 1 ? "" : "s"}</div>
            </div>

            {cart.length === 0 ? (
              <div className="border border-dashed border-white/20 bg-brand-black/20 p-10 text-center">
                <p className="text-xl font-display font-extrabold uppercase mb-2">Your bag is empty</p>
                <p className="text-muted-foreground">Add a hoodie from the collection above to see it here.</p>
              </div>
            ) : (
              <div className="grid lg:grid-cols-[1.5fr_0.8fr] gap-8">
                <div className="space-y-4">
                  {cart.map((item, index) => (
                    <div key={`${item.id}-${item.size}-${index}`} className="flex items-center justify-between gap-4 border border-white/10 bg-brand-black/30 p-4">
                      <div>
                        <p className="font-display font-extrabold uppercase text-xl">{item.name}</p>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">Size {item.size}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-display font-extrabold text-lg">${item.price}</span>
                        <button
                          onClick={() => removeFromCart(index)}
                          className="text-xs uppercase tracking-widest text-brand-red hover:text-brand-white transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <aside className="border border-white/10 bg-brand-black p-6">
                  <p className="text-xs font-bold uppercase tracking-widest text-brand-red mb-6">Summary</p>
                  <div className="flex justify-between text-sm text-muted-foreground mb-3">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground mb-3">
                    <span>Sales Tax (13%)</span>
                    <span>${tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground mb-6">
                    <span>Shipping</span>
                    <span>
                      {fulfillmentMethod === "pickup"
                        ? "$0.00 (Pickup)"
                        : checkout.postalCode.trim() && isValidCanadianPostalCode(checkout.postalCode)
                        ? `$${shippingCost.toFixed(2)}`
                        : "Calculated on Postal Code"}
                    </span>
                  </div>
                  <div className="flex justify-between font-display font-extrabold text-2xl uppercase mb-8">
                    <span>Total</span>
                    <span>${total.toFixed(2)}</span>
                  </div>

                  <form onSubmit={handlePlaceOrder} noValidate className="space-y-4 border-t border-white/10 pt-6">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                          First Name <span className="text-brand-red">*</span>
                        </label>
                        <input
                          type="text"
                          value={checkout.firstName}
                          onChange={(event) => handleCheckoutChange("firstName", event.target.value)}
                          aria-invalid={Boolean(firstNameError)}
                          className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                            firstNameError ? "border-brand-red" : "border-white/10"
                          }`}
                          required
                        />
                        {firstNameError && <p className="mt-2 text-xs text-brand-red">{firstNameError}</p>}
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                          Last Name <span className="text-brand-red">*</span>
                        </label>
                        <input
                          type="text"
                          value={checkout.lastName}
                          onChange={(event) => handleCheckoutChange("lastName", event.target.value)}
                          aria-invalid={Boolean(lastNameError)}
                          className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                            lastNameError ? "border-brand-red" : "border-white/10"
                          }`}
                          required
                        />
                        {lastNameError && <p className="mt-2 text-xs text-brand-red">{lastNameError}</p>}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        Email <span className="text-brand-red">*</span>
                      </label>
                      <input
                        type="email"
                        value={checkout.email}
                        onChange={(event) => handleCheckoutChange("email", event.target.value)}
                        aria-invalid={Boolean(emailError)}
                        className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                          emailError ? "border-brand-red" : "border-white/10"
                        }`}
                        required
                      />
                      {emailError && <p className="mt-2 text-xs text-brand-red">{emailError}</p>}
                    </div>

                    <div className="space-y-4 border border-white/10 bg-brand-grey/40 p-4 rounded-xl">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Delivery Method</label>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setFulfillmentMethod("shipping")}
                            className={`border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                              fulfillmentMethod === "shipping"
                                ? "border-brand-red bg-brand-red text-brand-white"
                                : "border-white/20 bg-brand-black/30 text-brand-white hover:border-brand-red"
                            }`}
                          >
                            Ship to Address
                          </button>
                          <button
                            type="button"
                            onClick={() => setFulfillmentMethod("pickup")}
                            className={`border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                              fulfillmentMethod === "pickup"
                                ? "border-brand-red bg-brand-red text-brand-white"
                                : "border-white/20 bg-brand-black/30 text-brand-white hover:border-brand-red"
                            }`}
                          >
                            Pick Up Myself
                          </button>
                        </div>
                      </div>

                      {fulfillmentMethod === "pickup" ? (
                        <div className="rounded-lg border border-brand-red/40 bg-brand-black/40 p-4 text-sm text-muted-foreground">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-red mb-2">Pickup Location</p>
                          <p className="text-brand-white font-semibold">{PICKUP_LOCATION.name}</p>
                          <p>{PICKUP_LOCATION.addressLine1}</p>
                          <p>
                            {PICKUP_LOCATION.city}, {PICKUP_LOCATION.province} {PICKUP_LOCATION.postalCode}
                          </p>
                          <p>{PICKUP_LOCATION.country}</p>
                          <p className="mt-3 text-brand-red text-xs uppercase tracking-widest">Shipping is free for pickup orders.</p>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Shipping Details</label>
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                          Full Name <span className="text-brand-red">*</span>
                        </label>
                        <input
                          type="text"
                          value={checkout.shippingFullName}
                          onChange={(event) => handleCheckoutChange("shippingFullName", event.target.value)}
                          aria-invalid={Boolean(shippingFullNameError)}
                          className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                            shippingFullNameError ? "border-brand-red" : "border-white/10"
                          }`}
                          required
                        />
                        {shippingFullNameError && <p className="mt-2 text-xs text-brand-red">{shippingFullNameError}</p>}
                      </div>

                      {fulfillmentMethod === "shipping" && (
                        <>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                              Street Address 1 <span className="text-brand-red">*</span>
                            </label>
                            <input
                              type="text"
                              value={checkout.addressLine1}
                              onChange={(event) => handleCheckoutChange("addressLine1", event.target.value)}
                              aria-invalid={Boolean(addressLine1Error)}
                              className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                                addressLine1Error ? "border-brand-red" : "border-white/10"
                              }`}
                              required
                            />
                            {addressLine1Error && <p className="mt-2 text-xs text-brand-red">{addressLine1Error}</p>}
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Street Address 2 (optional)</label>
                            <input
                              type="text"
                              value={checkout.addressLine2}
                              onChange={(event) => handleCheckoutChange("addressLine2", event.target.value)}
                              className="w-full bg-brand-grey border border-white/10 px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red"
                            />
                          </div>

                          <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                                City <span className="text-brand-red">*</span>
                              </label>
                              <input
                                type="text"
                                value={checkout.city}
                                onChange={(event) => handleCheckoutChange("city", event.target.value)}
                                aria-invalid={Boolean(cityError)}
                                className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                                  cityError ? "border-brand-red" : "border-white/10"
                                }`}
                                required
                              />
                              {cityError && <p className="mt-2 text-xs text-brand-red">{cityError}</p>}
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                                Province/Territory <span className="text-brand-red">*</span>
                              </label>
                              <select
                                value={checkout.province}
                                onChange={(event) => handleCheckoutChange("province", event.target.value)}
                                aria-invalid={Boolean(provinceError)}
                                className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                                  provinceError ? "border-brand-red" : "border-white/10"
                                }`}
                                required
                              >
                                <option value="">Select</option>
                                {canadaProvinces.map((province) => (
                                  <option key={province} value={province}>
                                    {province}
                                  </option>
                                ))}
                              </select>
                              {provinceError && <p className="mt-2 text-xs text-brand-red">{provinceError}</p>}
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                              Postal Code <span className="text-brand-red">*</span>
                            </label>
                            <input
                              type="text"
                              value={checkout.postalCode}
                              onChange={(event) => handleCheckoutChange("postalCode", event.target.value.toUpperCase())}
                              aria-invalid={Boolean(postalCodeError || shippingCostError)}
                              className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                                postalCodeError || shippingCostError ? "border-brand-red" : "border-white/10"
                              }`}
                              placeholder="A1A 1A1"
                              required
                            />
                            {postalCodeError && <p className="mt-2 text-xs text-brand-red">{postalCodeError}</p>}
                            {!postalCodeError && checkout.postalCode.trim() && !isValidCanadianPostalCode(checkout.postalCode) && (
                              <p className="mt-2 text-xs text-brand-red">Please enter a valid Canadian postal code format.</p>
                            )}
                            {isCalculatingShippingCost && checkout.postalCode.trim() && (
                              <p className="mt-2 text-xs text-white/70">Calculating shipping...</p>
                            )}
                            {!isCalculatingShippingCost && checkout.postalCode.trim() && isValidCanadianPostalCode(checkout.postalCode) && !shippingCostError && shippingCost > 0 && (
                              <p className="mt-2 text-xs text-brand-red">Shipping: ${shippingCost.toFixed(2)}</p>
                            )}
                            {!isCalculatingShippingCost && checkout.postalCode.trim() && isValidCanadianPostalCode(checkout.postalCode) && !shippingCostError && shippingCost === 0 && (
                              <p className="mt-2 text-xs text-brand-red">Shipping is being calculated for this postal code.</p>
                            )}
                            {shippingCostError && <p className="mt-2 text-xs text-brand-red">{shippingCostError}</p>}
                          </div>
                        </>
                      )}

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                          Phone Number <span className="text-brand-red">*</span>
                        </label>
                        <input
                          type="tel"
                          value={checkout.shippingPhone}
                          onChange={(event) => handleCheckoutChange("shippingPhone", event.target.value)}
                          aria-invalid={Boolean(shippingPhoneError)}
                          className={`w-full bg-brand-grey border px-3 py-2 text-sm text-brand-white outline-none focus:border-brand-red ${
                            shippingPhoneError ? "border-brand-red" : "border-white/10"
                          }`}
                          required
                        />
                        {shippingPhoneError && <p className="mt-2 text-xs text-brand-red">{shippingPhoneError}</p>}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Payment</label>

                      {!stripeEnabled && (
                        <p className="mb-3 text-[10px] uppercase tracking-widest text-brand-red">
                          Add your Stripe keys in .env to enable live checkout.
                        </p>
                      )}

                      {!stripeEnabled ? null : clientSecret ? (
                        <Elements
                          stripe={stripePromise}
                          options={{
                            clientSecret,
                            appearance: {
                              theme: "night",
                              variables: {
                                colorPrimary: "#f04d3f",
                                colorBackground: "#111111",
                                colorText: "#f5f5f5",
                                colorTextSecondary: "#c9c9c9",
                                borderRadius: "10px",
                              },
                            },
                          }}
                        >
                          <CheckoutPaymentForm
                            clientSecret={clientSecret}
                            onSubmitOrder={handlePlaceOrder}
                            paymentError={paymentError}
                            setPaymentError={setPaymentError}
                          />
                        </Elements>
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-brand-grey/40 p-4 text-xs uppercase tracking-widest text-muted-foreground">
                          {isPreparingPayment ? "Preparing secure payment..." : "Complete the delivery details, then continue to payment."}
                        </div>
                      )}

                      {paymentError && !clientSecret && <p className="mt-3 text-xs text-brand-red">{paymentError}</p>}
                    </div>

                    {!clientSecret && (
                      <button
                        type="button"
                        onClick={handlePreparePayment}
                        disabled={isPreparingPayment}
                        className="w-full bg-brand-red px-5 py-4 text-xs font-bold uppercase tracking-widest text-brand-white hover:bg-brand-white hover:text-brand-black transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isPreparingPayment ? "Preparing Payment..." : "Continue to Payment"}
                      </button>
                    )}
                  </form>
                </aside>
              </div>
            )}
          </>
        )}
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
            <a href="mailto:thedivinewithin1@gmail.com" className="text-muted-foreground hover:text-brand-white transition-colors">
              Contact Us
            </a>
            <Link to="/admin" className="text-muted-foreground hover:text-brand-white transition-colors">
              Inventory Manager
            </Link>
          </div>
          <div className="flex flex-col space-y-6">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-red">Secure Checkout</span>
            <div className="flex gap-4 items-center">
              <div className="h-8 w-16 bg-white/10 rounded border border-white/10 flex items-center justify-center">
                <span className="text-[8px] font-bold text-brand-white uppercase">Visa</span>
              </div>
              <div className="h-8 w-16 bg-white/10 rounded border border-white/10 flex items-center justify-center">
                <span className="text-[8px] font-bold text-brand-white uppercase">Apple Pay</span>
              </div>
            </div>
            <div className="pt-4">
              <form
                className={`flex border-b transition-colors ${
                  isSubscribed ? "border-brand-red" : subscribeError ? "border-brand-red" : "border-white/20"
                }`}
                onSubmit={handleStockSignup}
              >
                <input
                  type="email"
                  value={subscriberEmail}
                  onChange={(event) => {
                    setSubscriberEmail(event.target.value);
                    setSubscribeError("");
                    setSubscribeStatus("");
                    setIsSubscribed(false);
                  }}
                  placeholder="Join the tribe (Email)"
                  aria-label="Email for stock updates"
                  className="bg-transparent py-2 text-sm w-full outline-none focus:placeholder-transparent transition-all text-brand-white placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={isSubscribing}
                  className={`font-bold text-xl disabled:opacity-60 transition-colors ${
                    isSubscribed ? "text-brand-white" : "text-brand-red"
                  }`}
                >
                  {isSubscribing ? "..." : isSubscribed ? "✓" : "→"}
                </button>
              </form>
              <div aria-live="polite">
                {isSubscribed && (
                  <p className="mt-3 rounded border border-brand-red/40 bg-brand-red/10 px-3 py-2 text-xs uppercase tracking-widest text-brand-red">
                    You are in. We will email you when new stock drops.
                  </p>
                )}
                {!isSubscribed && subscribeStatus && (
                  <p className="mt-3 text-xs text-brand-red uppercase tracking-widest">{subscribeStatus}</p>
                )}
                {subscribeError && <p className="mt-3 text-xs text-brand-red uppercase tracking-widest">{subscribeError}</p>}
              </div>
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
