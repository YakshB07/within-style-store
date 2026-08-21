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

type RestockDigestStore = {
  pending: RestockUpdatePayload[];
  timer: ReturnType<typeof setTimeout> | null;
};

const RESTOCK_DIGEST_WINDOW_MS = 90_000;

const getSubscriberStore = (): SubscriberStore => {
  const globalState = globalThis as typeof globalThis & {
    __tdwSubscriberStore?: SubscriberStore;
  };

  if (!globalState.__tdwSubscriberStore) {
    globalState.__tdwSubscriberStore = { emails: new Set<string>() };
  }

  return globalState.__tdwSubscriberStore;
};

const getRestockDigestStore = (): RestockDigestStore => {
  const globalState = globalThis as typeof globalThis & {
    __tdwRestockDigestStore?: RestockDigestStore;
  };

  if (!globalState.__tdwRestockDigestStore) {
    globalState.__tdwRestockDigestStore = { pending: [], timer: null };
  }

  return globalState.__tdwRestockDigestStore;
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
  return sendRestockDigestEmail([payload]);
};

const sendRestockDigestEmail = async (updates: RestockUpdatePayload[]) => {
  if (!updates.length) {
    return { success: true as const, sentCount: 0, reason: "no-updates" as const };
  }

  const subscribers = getStockSubscribers();
  if (!subscribers.length) {
    return { success: true as const, sentCount: 0, reason: "no-subscribers" as const };
  }

  const transporterState = createTransporter();
  if (!transporterState.ready) {
    return { success: false as const, reason: transporterState.reason };
  }

  await transporterState.transporter.verify();
  const updateLines = updates
    .map(
      (update) =>
        `- ${update.productName} | Size ${update.size} | ${update.previousQty} -> ${update.newQty}`,
    )
    .join("\n");

  await transporterState.transporter.sendMail({
    from: transporterState.fromAddress,
    to: transporterState.fromAddress,
    bcc: subscribers,
    subject: "The Divine Within restock update",
    text: [
      "New stock is available.",
      "",
      "This update includes all recent restocks:",
      updateLines,
      "",
      "Visit the store to order while it is available.",
    ].join("\n"),
  });

  return { success: true as const, sentCount: subscribers.length };
};

export const queueRestockUpdateEmail = async (payload: RestockUpdatePayload) => {
  const digestStore = getRestockDigestStore();

  const existingIndex = digestStore.pending.findIndex(
    (update) => update.productName === payload.productName && update.size === payload.size,
  );

  if (existingIndex >= 0) {
    const existing = digestStore.pending[existingIndex];
    digestStore.pending[existingIndex] = {
      ...existing,
      previousQty: Math.min(existing.previousQty, payload.previousQty),
      newQty: payload.newQty,
    };
  } else {
    digestStore.pending.push(payload);
  }

  if (digestStore.timer) {
    clearTimeout(digestStore.timer);
  }

  digestStore.timer = setTimeout(() => {
    void flushQueuedRestockUpdates();
  }, RESTOCK_DIGEST_WINDOW_MS);

  return {
    success: true as const,
    queuedCount: digestStore.pending.length,
    sendsInSeconds: Math.floor(RESTOCK_DIGEST_WINDOW_MS / 1000),
  };
};

export const flushQueuedRestockUpdates = async () => {
  const digestStore = getRestockDigestStore();

  if (!digestStore.pending.length) {
    digestStore.timer = null;
    return { success: true as const, sentCount: 0, reason: "no-updates" as const };
  }

  const updatesToSend = [...digestStore.pending];
  digestStore.pending = [];
  digestStore.timer = null;

  return sendRestockDigestEmail(updatesToSend);
};