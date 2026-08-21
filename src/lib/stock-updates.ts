import nodemailer from "nodemailer";

type SubscriberStore = {
  emails: Set<string>;
};

type RestockUpdatePayload = {
  productName: string;
  size: string;
  previousQty: number;
  newQty: number;
};

const getSubscriberStore = (): SubscriberStore => {
  const globalState = globalThis as typeof globalThis & {
    __tdwSubscriberStore?: SubscriberStore;
  };

  if (!globalState.__tdwSubscriberStore) {
    globalState.__tdwSubscriberStore = { emails: new Set<string>() };
  }

  return globalState.__tdwSubscriberStore;
};

const getSmtpConfig = () => {
  const smtpHost = process.env["SMTP_HOST"]?.trim();
  const smtpPort = Number(process.env["SMTP_PORT"] ?? "587");
  const smtpUser = process.env["SMTP_USER"]?.trim();
  const smtpPass = process.env["SMTP_PASS"]?.trim();
  const fromAddress = process.env["SMTP_FROM"]?.trim() ?? smtpUser ?? "no-reply@thedivinewithin.com";

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromAddress,
  };
};

const createTransporter = () => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, fromAddress } = getSmtpConfig();

  if (!smtpHost || !smtpUser || !smtpPass) {
    return { ready: false as const, reason: "missing-smtp-config" as const };
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

  return { ready: true as const, transporter, fromAddress };
};

export const addStockSubscriber = (email: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  const store = getSubscriberStore();
  const alreadySubscribed = store.emails.has(normalizedEmail);
  store.emails.add(normalizedEmail);
  return { alreadySubscribed };
};

export const getStockSubscribers = () => {
  const store = getSubscriberStore();
  return Array.from(store.emails);
};

export const sendSubscriptionConfirmationEmail = async (email: string) => {
  const transporterState = createTransporter();
  if (!transporterState.ready) {
    return { success: false as const, reason: transporterState.reason };
  }

  await transporterState.transporter.verify();
  await transporterState.transporter.sendMail({
    from: transporterState.fromAddress,
    to: email,
    subject: "You are subscribed to The Divine Within stock updates",
    text: [
      "Thank you for joining The Divine Within tribe.",
      "",
      "You will receive an email when new stock is available.",
    ].join("\n"),
  });

  return { success: true as const };
};

export const sendRestockUpdateEmails = async (payload: RestockUpdatePayload) => {
  const subscribers = getStockSubscribers();
  if (!subscribers.length) {
    return { success: true as const, sentCount: 0, reason: "no-subscribers" as const };
  }

  const transporterState = createTransporter();
  if (!transporterState.ready) {
    return { success: false as const, reason: transporterState.reason };
  }

  await transporterState.transporter.verify();
  await transporterState.transporter.sendMail({
    from: transporterState.fromAddress,
    to: transporterState.fromAddress,
    bcc: subscribers,
    subject: "The Divine Within restock update",
    text: [
      "A popular item is back in stock.",
      "",
      `Product: ${payload.productName}`,
      `Size: ${payload.size}`,
      `Previous stock: ${payload.previousQty}`,
      `Current stock: ${payload.newQty}`,
      "",
      "Visit the store to order while it is available.",
    ].join("\n"),
  });

  return { success: true as const, sentCount: subscribers.length };
};