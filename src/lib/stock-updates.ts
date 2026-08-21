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

type RestockSyncPayload = {
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

type DispatchSuccessReason = "sent" | "sent-fallback" | "no-updates" | "no-subscribers";
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
  const fallbackToAddress = process.env["ORDER_EMAIL_TO"]?.trim() ?? fromAddress;

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromAddress,
    fallbackToAddress,
  };
};

const createTransporter = () => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, fromAddress, fallbackToAddress } = getSmtpConfig();

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

  return { ready: true as const, transporter, fromAddress, fallbackToAddress };
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

  const transporterState = createTransporter();
  if (!transporterState.ready) {
    return { success: false, sentCount: 0, reason: "missing-smtp-config" };
  }

  const updateLines = updates
    .map(
      (update) =>
        `- ${update.productName}, size ${update.size}: ${update.previousQty} to ${update.newQty}`,
    )
    .join("\n");


  try {
    await transporterState.transporter.verify();

    const hasSubscribers = subscribers.length > 0;
    const toAddress = hasSubscribers
      ? transporterState.fromAddress
      : transporterState.fallbackToAddress;

    await transporterState.transporter.sendMail({
      from: transporterState.fromAddress,
      to: toAddress,
      ...(hasSubscribers ? { bcc: subscribers } : {}),
      subject: "The Divine Within stock update",
      text: [
        "Hi there,",
        "",
        "Great news - we have updated stock on The Divine Within store.",
        "",
        "Here are the confirmed changes:",
        updateLines,
        "",
        "If one of these was on your list, now is a good time to order before it sells out again.",
        "",
        "With gratitude,",
        "The Divine Within",
        hasSubscribers ? "" : "",
        hasSubscribers ? "" : "Note: This copy was sent to the store inbox fallback because no subscriber list was available in memory.",
      ].join("\n"),
    });

    return {
      success: true,
      sentCount: hasSubscribers ? subscribers.length : 1,
      reason: hasSubscribers ? "sent" : "sent-fallback",
    };
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

export const syncQueuedRestockUpdate = async (payload: RestockSyncPayload) => {
  const digestStore = getRestockDigestStore();

  const existingIndex = digestStore.pending.findIndex(
    (update) => update.productName === payload.productName && update.size === payload.size,
  );

  if (existingIndex >= 0) {
    if (payload.newQty <= 0) {
      digestStore.pending.splice(existingIndex, 1);
    } else {
      const existing = digestStore.pending[existingIndex];
      digestStore.pending[existingIndex] = {
        ...existing,
        previousQty: Math.min(existing.previousQty, payload.previousQty),
        newQty: payload.newQty,
      };
    }

    digestStore.lastReason = "queued";
    digestStore.lastError = null;
    return {
      success: true as const,
      queuedCount: digestStore.pending.length,
    };
  }

  if (payload.previousQty <= 0 && payload.newQty > 0) {
    return queueRestockUpdateEmail({
      productName: payload.productName,
      size: payload.size,
      previousQty: payload.previousQty,
      newQty: payload.newQty,
    });
  }

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

export const clearQueuedRestockUpdates = () => {
  const digestStore = getRestockDigestStore();
  const clearedCount = digestStore.pending.length;
  digestStore.pending = [];
  digestStore.lastReason = "queue-cleared";
  digestStore.lastError = null;
  return { success: true as const, clearedCount };
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