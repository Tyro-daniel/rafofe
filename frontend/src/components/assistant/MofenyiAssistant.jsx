import React, { useState, useRef, useEffect } from "react";
import { FiMessageCircle, FiX, FiSend } from "react-icons/fi";
import "./MofenyiAssistant.css";

/**
 * "Mofenyi" (Setswana: winner/one who succeeds) is this app's AI-first
 * surface — reachable from every screen via the floating button, not
 * buried in a settings menu. This is what "AI-first design" means
 * structurally: the assistant is a first-class piece of the shell, not a
 * bolted-on widget.
 *
 * NAMING HISTORY: this component was originally named "Thuso" (Setswana:
 * help/assistance) and was renamed to "Mofenyi" at the business's
 * request. If you're searching old commit history, docs, or design
 * discussion for "Thuso", that's this same component.
 *
 * IMPORTANT — current implementation status:
 * The design doc (see /docs, or the project README) specifies a real,
 * RAG-backed LLM assistant scoped to budgeting tips, product Q&A, and the
 * user's own statement data, as a Phase 2 backend deliverable — the
 * backend has no /assistant endpoint yet (MVP scope stopped at Phase 1).
 * Rather than leave the AI-first requirement entirely unaddressed, or
 * fake a real AI response, this component ships a small local
 * pattern-matched responder for common questions (clearly the honest
 * thing to do — it is NOT calling any LLM right now) and isolates that
 * behind ONE function: getAssistantReply(). Swap that function's body for
 * a real `await api.post("/assistant/sessions/:id/messages", ...)` call
 * once the backend Phase 2 work lands, and nothing else in this
 * component needs to change. See the Support & Maintenance Manual,
 * section "Making the AI Assistant read from the database", for the
 * concrete steps to do that.
 */

const FAQ = [
  { match: /interest|rate|mpr/i, reply: "Our Small Micro Loan (P500–P10,000) is 30% MPR per month, and our Medium Loan (P10,000–P15,000) is 25% MPR per month. For example, P1,000 on the Small Micro Loan costs P300 in interest the first month. Need more than P15,000? That's arranged directly with a loan officer." },
  { match: /document|id|payslip|upload/i, reply: "You'll need a valid national ID and your most recent payslip. Upload both from the Documents page — a loan officer reviews them, usually within one business day." },
  { match: /how (long|much time)|when.*(approv|decision)/i, reply: "Most applications are reviewed within 1 business day once your documents are verified." },
  { match: /late|penalt|miss.*payment/i, reply: "Late payments are charged a penalty capped at 5% of your outstanding balance per month, in line with NBFIRA's microlending regulations — it can never exceed your total outstanding principal." },
  { match: /apply|application/i, reply: "Head to \"Apply for a loan\" in the menu, choose a loan product, and enter the amount and tenure you need. You can upload your documents before or after submitting. Loans above P15,000 need a loan officer's help rather than this form." },
  { match: /budget|save|saving/i, reply: "A simple rule: try to keep loan repayments under 30% of your monthly income. Want help thinking through a repayment plan for a specific amount? Tell me the amount and tenure you're considering." },
  { match: /large loan|more than|bigger loan/i, reply: "Loans above P15,000 are arranged manually with a loan officer rather than through the online form — please contact one of our branches to discuss your requirements." },
];

function getAssistantReply(userMessage) {
  const hit = FAQ.find((f) => f.match.test(userMessage));
  if (hit) return hit.reply;
  return "I can help with questions about loan products, requirements, interest rates, and repayments. For anything account-specific, a loan officer can help — you can reach them from the Documents or Applications page.";
}

export function MofenyiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { from: "mofenyi", text: "Dumela! I am Mofenyi. You can ask me about our loan products, process, or requirements." },
  ]);
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const reply = getAssistantReply(text);
    setMessages((prev) => [...prev, { from: "user", text }, { from: "mofenyi", text: reply }]);
    setDraft("");
  }

  return (
    <>
      <button
        className="mofenyi-fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close Mofenyi assistant" : "Open Mofenyi assistant"}
      >
        {open ? <FiX /> : <FiMessageCircle />}
      </button>

      {open && (
        <div className="mofenyi-panel" role="dialog" aria-label="Mofenyi assistant">
          <div className="mofenyi-header">
            <div>
              <strong>Mofenyi</strong>
              <span className="mofenyi-subtitle">Your loan assistant</span>
            </div>
          </div>

          <div className="mofenyi-messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`mofenyi-bubble mofenyi-bubble-${m.from}`}>{m.text}</div>
            ))}
          </div>

          <form className="mofenyi-input-row" onSubmit={handleSend}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about loans, requirements, repayments…"
              aria-label="Message Mofenyi"
            />
            <button type="submit" aria-label="Send message"><FiSend /></button>
          </form>
        </div>
      )}
    </>
  );
}
