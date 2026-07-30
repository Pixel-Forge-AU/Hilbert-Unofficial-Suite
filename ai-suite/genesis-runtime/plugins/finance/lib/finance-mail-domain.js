const READ_RECEIPT_PATTERN = /\b(read receipt|delivery receipt|return receipt)\b/i;
const SECURITY_ALERT_PATTERN = /\b(security alert|password reset|verification code|verify your account|confirm your identity|unusual sign-in|account suspended|click the link below|wallet|seed phrase|gift card)\b/i;
const FINANCE_SENDER_PATTERN = /\b(accounts?|billing|invoice|invoic(?:er|ing)|payments?|receipts?|payables?|remittance|xero|stripe|quickbooks|myob|paypal)\b/i;
const INVOICE_OR_BILL_PATTERN = /\b(tax invoice|invoice|bill)\b/i;
const STATEMENT_PATTERN = /\b(statement|statement of account|account statement)\b/i;
const DUE_SIGNAL_PATTERN = /\b(amount due|payment due|balance due|due date|due on|pay by|overdue|past due|bill is due|invoice is due)\b/i;
const DOCUMENT_CUE_PATTERN = /\b(attached invoice|invoice attached|download invoice|view invoice|view bill|download bill)\b/i;
const PAYMENT_CONFIRMATION_PATTERN = /\b(payment received|payment successful|payment confirmed|payment processed|invoice paid|paid in full|remittance advice|deposit received|payout sent|credited to your account|credited back)\b/i;
const FINANCE_RECEIPT_PATTERN = /\b(payment receipt|tax receipt|receipt for|your receipt|receipt number)\b/i;
const REFUND_PATTERN = /\b(refund(?:ed|s)?|refund issued|refund processed|refund received|credit note)\b/i;
const INCOME_PATTERN = /\b(payment received|client payment|customer payment|invoice paid|deposit received|payout|sale completed|sale confirmed|remittance advice|credited to your account)\b/i;
const EXPLICIT_INBOUND_PAYMENT_PATTERN = /\b(payment received|client payment|customer payment|deposit received|payout|credited to your account)\b/i;
const EXPENSE_PATTERN = /\b(invoice|bill|statement|charge|charged|debit|subscription invoice|renewal invoice|amount due)\b/i;
const PROPOSAL_OR_QUOTE_PATTERN = /\b(proposal|quote)\b/i;
const SUBSCRIPTION_RENEWAL_PATTERN = /\b(subscription|renewal|renews|auto-renew)\b/i;
const INVOICE_REFERENCE_PATTERN = /\b(?:invoice|inv|bill|statement|receipt|account)\s*(?:number|no\.?|#|id)?\s*[:\-]?\s*[a-z0-9][a-z0-9-]{2,}\b/i;
const SHORT_CODE_PATTERN = /\b[a-z]{2,8}-\d{3,}\b/i;

export function normalizeFinanceCurrency(value = "", fallback = "AUD") {
  const normalized = String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  return normalized || fallback;
}

export function parseMoneyValue(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(2)) : 0;
}

const MONTHS_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function extractFinanceDate(text = "") {
  const raw = String(text || "");
  let m;

  m = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d.getTime();
  }

  m = raw.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i);
  if (m) {
    const month = MONTHS_MAP[m[2].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      const d = new Date(Number(m[3]), month, Number(m[1]));
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }

  m = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) {
    const month = MONTHS_MAP[m[1].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      const d = new Date(Number(m[3]), month, Number(m[2]));
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }

  m = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(d.getTime())) return d.getTime();
  }

  return 0;
}

export function extractFinanceAmount(text = "") {
  const raw = String(text || "");
  const patterns = [
    /(?:\b(AUD|USD|EUR|GBP|NZD|CAD)\b\s*)?(A?\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
    /\b(AUD|USD|EUR|GBP|NZD|CAD)\b\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) {
      continue;
    }
    const symbol = match[2] || "";
    const numericText = match[3] || match[2] || "";
    const value = parseMoneyValue(numericText);
    if (!value) {
      continue;
    }
    const currency = normalizeFinanceCurrency(
      match[1]
        || (symbol === "A$" ? "AUD" : "")
        || (symbol === "$" ? "AUD" : ""),
      "AUD"
    );
    return {
      value,
      currency,
      display: `${currency} ${value.toFixed(2)}`
    };
  }
  return {
    value: 0,
    currency: "AUD",
    display: ""
  };
}

export function inferFinanceCategory(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/\b(subscription|renewal|monthly plan|annual plan|license|saas|hosting|domain renewal)\b/.test(lower)) return "subscriptions";
  if (/\b(tax|gst|vat|bas|payg|ato)\b/.test(lower)) return "tax";
  if (/\b(payroll|salary|wage|superannuation)\b/.test(lower)) return "payroll";
  if (/\b(rent|lease)\b/.test(lower)) return "rent";
  if (/\b(utility|electricity|gas|water|internet|phone)\b/.test(lower)) return "utilities";
  if (/\b(travel|flight|hotel|uber|taxi|booking)\b/.test(lower)) return "travel";
  if (/\b(advertising|ads|marketing|campaign|seo)\b/.test(lower)) return "marketing";
  if (/\b(insurance)\b/.test(lower)) return "insurance";
  if (/\b(bank fee|merchant fee|stripe|paypal fee|processing fee)\b/.test(lower)) return "banking";
  if (/\b(hardware|equipment|device|laptop|monitor|keyboard)\b/.test(lower)) return "equipment";
  if (/\b(contractor|freelancer|consulting|agency|professional services)\b/.test(lower)) return "services";
  if (/\b(client payment|customer payment|invoice paid|remittance|deposit received|payout|sale)\b/.test(lower)) return "sales";
  if (/\b(refund)\b/.test(lower)) return "refunds";
  return "uncategorized";
}

export function analyzeMailForFinance({
  fromName = "",
  fromAddress = "",
  subject = "",
  text = "",
  receivedAt = 0
} = {}) {
  const senderText = `${String(fromName || "").trim()}\n${String(fromAddress || "").trim()}`;
  const contentText = `${String(subject || "").trim()}\n${String(text || "").trim()}`;
  const combined = `${senderText}\n${contentText}`.toLowerCase();
  const amount = extractFinanceAmount(contentText);
  const extractedDate = extractFinanceDate(contentText);

  const readReceiptLike = READ_RECEIPT_PATTERN.test(combined);
  const securityAlertLike = SECURITY_ALERT_PATTERN.test(combined);
  const financeSenderLike = FINANCE_SENDER_PATTERN.test(senderText);
  const invoiceOrBillKeyword = INVOICE_OR_BILL_PATTERN.test(combined);
  const statementKeyword = STATEMENT_PATTERN.test(combined);
  const dueSignal = DUE_SIGNAL_PATTERN.test(combined);
  const documentCue = DOCUMENT_CUE_PATTERN.test(combined);
  const paymentConfirmation = PAYMENT_CONFIRMATION_PATTERN.test(combined);
  const financeReceipt = !readReceiptLike && FINANCE_RECEIPT_PATTERN.test(combined);
  const refundSignal = REFUND_PATTERN.test(combined);
  const invoiceReferenceLike = INVOICE_REFERENCE_PATTERN.test(combined)
    || ((invoiceOrBillKeyword || statementKeyword) && SHORT_CODE_PATTERN.test(combined));
  const proposalOnly = PROPOSAL_OR_QUOTE_PATTERN.test(combined)
    && !invoiceOrBillKeyword
    && !statementKeyword
    && !dueSignal
    && !paymentConfirmation
    && !refundSignal
    && !financeReceipt;
  const renewalOnly = SUBSCRIPTION_RENEWAL_PATTERN.test(combined)
    && !invoiceOrBillKeyword
    && !statementKeyword
    && !dueSignal
    && !paymentConfirmation
    && !refundSignal
    && !financeReceipt
    && amount.value === 0;

  let evidenceScore = 0;
  if (invoiceOrBillKeyword) evidenceScore += 3;
  if (statementKeyword) evidenceScore += 1;
  if (dueSignal) evidenceScore += 2;
  if (documentCue) evidenceScore += 1;
  if (paymentConfirmation) evidenceScore += 2;
  if (financeReceipt) evidenceScore += 2;
  if (refundSignal) evidenceScore += 2;
  if (financeSenderLike) evidenceScore += 1;
  if (invoiceReferenceLike) evidenceScore += 1;
  if (amount.value > 0) evidenceScore += 2;
  if (securityAlertLike) evidenceScore -= 3;
  if (proposalOnly || renewalOnly || readReceiptLike) evidenceScore -= 4;

  const invoiceDetected = (invoiceOrBillKeyword || statementKeyword || dueSignal || documentCue)
    && (amount.value > 0 || dueSignal || financeSenderLike || invoiceReferenceLike || documentCue);
  const paymentDetected = (paymentConfirmation || financeReceipt || refundSignal)
    && (amount.value > 0 || financeSenderLike || invoiceReferenceLike || invoiceOrBillKeyword || statementKeyword);
  const detected = !readReceiptLike
    && !proposalOnly
    && !renewalOnly
    && !(securityAlertLike && !invoiceDetected && !paymentDetected)
    && (invoiceDetected || paymentDetected)
    && evidenceScore >= 4;

  if (!detected) {
    return {
      detected: false,
      type: "",
      status: "",
      category: "",
      amountValue: 0,
      currency: "AUD",
      amountDisplay: "",
      confidence: 0,
      detectionKind: ""
    };
  }

  const incomeLike = INCOME_PATTERN.test(combined);
  const explicitInboundPayment = EXPLICIT_INBOUND_PAYMENT_PATTERN.test(combined);
  const expenseLike = EXPENSE_PATTERN.test(combined);
  const status = dueSignal && !paymentConfirmation && !refundSignal && !financeReceipt
    ? "unpaid"
    : "paid";
  const detectionKind = refundSignal
    ? "refund"
    : status === "unpaid"
      ? "invoice"
      : "payment";
  const type = refundSignal || explicitInboundPayment || (incomeLike && !expenseLike) ? "income" : "expense";
  const confidence = [
    invoiceOrBillKeyword || paymentConfirmation || refundSignal,
    dueSignal || financeReceipt || documentCue,
    financeSenderLike || invoiceReferenceLike,
    amount.value > 0
  ].filter(Boolean).length;

  return {
    detected: true,
    type,
    status,
    category: inferFinanceCategory(combined),
    amountValue: amount.value,
    currency: amount.currency,
    amountDisplay: amount.display,
    occurredAt: extractedDate || Number(receivedAt || 0) || Date.now(),
    confidence,
    detectionKind
  };
}
