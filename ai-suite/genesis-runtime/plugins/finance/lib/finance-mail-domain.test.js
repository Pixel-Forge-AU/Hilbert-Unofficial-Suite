import { analyzeMailForFinance } from "./finance-mail-domain.js";

const tests = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}. ${message}`);
  }
}

test("Detect invoice email with due wording as unpaid expense", () => {
  const result = analyzeMailForFinance({
    fromName: "Conyak",
    fromAddress: "invoicereminders@post.xero.com",
    subject: "Bill INV-006616 from CONYAK is due",
    text: "Amount due A$132.00. Due date 5 Apr 2026. View invoice online.",
    receivedAt: 1774725247000
  });

  assert(result.detected, "Expected the invoice mail to be detected.");
  assertEqual(result.detectionKind, "invoice", "Due invoices should stay classified as invoices.");
  assertEqual(result.status, "unpaid", "Due invoices should not be marked paid.");
  assertEqual(result.type, "expense", "Bills should default to expense.");
  assertEqual(result.amountValue, 132, "Expected invoice amount extraction.");
});

test("Detect payment confirmation as paid income", () => {
  const result = analyzeMailForFinance({
    fromName: "Payments",
    fromAddress: "billing@payments.example.com",
    subject: "Payment received for invoice INV-1002",
    text: "Payment received. AUD 245.00 has been credited to your account.",
    receivedAt: 1774885455584
  });

  assert(result.detected, "Expected payment confirmation mail to be detected.");
  assertEqual(result.detectionKind, "payment", "Expected payment detection kind.");
  assertEqual(result.status, "paid", "Payment confirmations should be paid.");
  assertEqual(result.type, "income", "Incoming customer payments should be income.");
  assertEqual(result.amountValue, 245, "Expected payment amount extraction.");
});

test("Ignore generic proposal email", () => {
  const result = analyzeMailForFinance({
    fromName: "Agency Partner",
    fromAddress: "alex@agency.example.com",
    subject: "Proposal for Q2 discovery work",
    text: "I've attached the proposal deck for review next week."
  });

  assertEqual(result.detected, false, "Generic proposals should not enter finance.");
});

test("Ignore read receipt email", () => {
  const result = analyzeMailForFinance({
    fromName: "Mail System",
    fromAddress: "postmaster@example.com",
    subject: "Read receipt for: Team meeting notes",
    text: "This is a return receipt for the message you sent."
  });

  assertEqual(result.detected, false, "Read receipts should never enter finance.");
});

test("Ignore subscription renewal reminders without bill evidence", () => {
  const result = analyzeMailForFinance({
    fromName: "Example Service",
    fromAddress: "hello@example-service.com",
    subject: "Your subscription renews tomorrow",
    text: "Your plan will auto-renew tomorrow. Manage preferences online."
  });

  assertEqual(result.detected, false, "Renewal reminders without invoice evidence should stay out of finance.");
});

test("Ignore payment-failed security bait without invoice evidence", () => {
  const result = analyzeMailForFinance({
    fromName: "Security Alerts",
    fromAddress: "noreply@example-security.com",
    subject: "Payment failed - verify your account",
    text: "Click the link below to confirm your identity and restore access."
  });

  assertEqual(result.detected, false, "Security bait should not be treated as a finance item.");
});

async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      passCount += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failCount += 1;
      console.error(`FAIL ${name}`);
      console.error(`  ${error.message}`);
    }
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

run();
