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
  isSending: boolean;
  lastAttemptAt: string | null;
  lastSentAt: string | null;
  lastSentCount: number;
  lastReason: string | null;
  lastError: string | null;
};

type DispatchSuccessReason = "sent" | "no-updates" | "no-subscribers";
type DispatchFailureReason = "missing-smtp-config" | "send-failed" | "already-sending";

type DispatchResult =
  | { success: true; sentCount: number; reason: DispatchSuccessReason }
  | { success: false; sentCount: number; reason: DispatchFailureReason; message?: string };

const MAX_PENDING_UPDATES = 200;

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
    globalState.__tdwRestockDigestStore = {
      pending: [],
      isSending: false,
      lastAttemptAt: null,
      lastSentAt: null,
      lastSentCount: 0,
      lastReason: null,
      lastError: null,
    };
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

  try {
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
  } catch (error) {
    return {
      success: false as const,
      reason: "send-failed" as const,
      message: error instanceof Error ? error.message : "Unknown SMTP error",
    };
  }
};

export const sendRestockUpdateEmails = async (payload: RestockUpdatePayload) => {
  return sendRestockDigestEmail([payload]);
};

const sendRestockDigestEmail = async (updates: RestockUpdatePayload[]): Promise<DispatchResult> => {
  if (!updates.length) {
    return { success: true, sentCount: 0, reason: "no-updates" };
  }

  const subscribers = getStockSubscribers();
  if (!subscribers.length) {
    return { success: true, sentCount: 0, reason: "no-subscribers" };
  }

  const transporterState = createTransporter();
  if (!transporterState.ready) {
    return { success: false, sentCount: 0, reason: "missing-smtp-config" };
  }

  const updateLines = updates
    .map(
      (update) =>
        `- ${update.productName} | Size ${update.size} | ${update.previousQty} -> ${update.newQty}`,
    )
    .join("\n");


  try {
    await transporterState.transporter.verify();
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

    return { success: true, sentCount: subscribers.length, reason: "sent" };
  } catch (error) {
    return {
      success: false,
      sentCount: 0,
      reason: "send-failed",
      message: error instanceof Error ? error.message : "Unknown SMTP error",
    };
  }
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
    if (digestStore.pending.length >= MAX_PENDING_UPDATES) {
      digestStore.pending.shift();
    }

    digestStore.pending.push(payload);
  }

  digestStore.lastReason = "queued";
  digestStore.lastError = null;

  return {
    success: true as const,
    queuedCount: digestStore.pending.length,
  };
};

export const getRestockDigestStatus = () => {
  const digestStore = getRestockDigestStore();
  return {
    queuedCount: digestStore.pending.length,
    isSending: digestStore.isSending,
    subscriberCount: getStockSubscribers().length,
    lastAttemptAt: digestStore.lastAttemptAt,
    lastSentAt: digestStore.lastSentAt,
    lastSentCount: digestStore.lastSentCount,
    lastReason: digestStore.lastReason,
    lastError: digestStore.lastError,
  };
};

export const flushQueuedRestockUpdates = async () => {
  const digestStore = getRestockDigestStore();

  if (digestStore.isSending) {
    return { success: false as const, sentCount: 0, reason: "already-sending" as const };
  }

  if (!digestStore.pending.length) {
    digestStore.lastReason = "no-updates";
    return { success: true as const, sentCount: 0, reason: "no-updates" as const };
  }

  digestStore.isSending = true;
  digestStore.lastAttemptAt = new Date().toISOString();
  const updatesToSend = [...digestStore.pending];
  const result = await sendRestockDigestEmail(updatesToSend);

  if (result.success) {
    digestStore.pending = [];
    digestStore.lastSentAt = new Date().toISOString();
    digestStore.lastSentCount = result.sentCount;
    digestStore.lastReason = result.reason;
    digestStore.lastError = null;
  } else {
    digestStore.lastReason = result.reason;
    digestStore.lastError = result.message ?? result.reason;
  }

  digestStore.isSending = false;

  return result;
};