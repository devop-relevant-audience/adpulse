export interface MockEmail {
  to: string[];
  subject: string;
  body: string;
  sentAt: string;
}

export function sendMockEmail(email: Omit<MockEmail, "sentAt">): MockEmail {
  const sent: MockEmail = {
    ...email,
    sentAt: new Date().toISOString(),
  };

  console.log(
    `\n[MOCK EMAIL] ─────────────────────────────────\n` +
    `  To:      ${sent.to.join(", ")}\n` +
    `  Subject: ${sent.subject}\n` +
    `  Sent:    ${sent.sentAt}\n` +
    `  Body:\n${sent.body.split("\n").map((l) => `    ${l}`).join("\n")}\n` +
    `──────────────────────────────────────────────\n`
  );

  return sent;
}
