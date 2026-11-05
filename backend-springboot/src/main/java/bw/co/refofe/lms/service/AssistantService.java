package bw.co.refofe.lms.service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AssistantService {
    private static final Pattern APPLICATION_QUESTION =
            Pattern.compile("\\b(apply|application|applying|start an application|process)\\b");
    private static final Pattern DOCUMENT_QUESTION =
            Pattern.compile("\\b(document|documents|paperwork|id|payslip|bank statement|proof of address|kyc)\\b");
    private static final Pattern SPOUSAL_QUESTION =
            Pattern.compile("\\b(spous|married|marriage|community of property)\\b");
    private static final Pattern PAYMENT_QUESTION =
            Pattern.compile("\\b(repay|repayment|payment|pay online|debit order|debit collection)\\b");
    private static final Pattern STATUS_QUESTION =
            Pattern.compile("\\b(status|track|tracking|progress|application update)\\b");
    private static final Pattern DECISION_QUESTION =
            Pattern.compile("\\b(approve|approval|approved|decline|declined|decision|decide|credit score|predict|ai|artificial intelligence|automated)\\b");
    private static final Pattern PRODUCT_QUESTION =
            Pattern.compile("\\b(product|products|loan amount|interest|rate|rates|tenure|term|how much|how long)\\b");
    private static final Pattern COMPLAINT_QUESTION =
            Pattern.compile("\\b(complaint|complain|grievance|dispute)\\b");
    private static final Pattern REGULATORY_QUESTION =
            Pattern.compile("\\b(nbfira|regulat|licen[cs]e|responsible borrow|financial literacy)\\b");

    private final JdbcTemplate jdbc;

    public AssistantService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String answer(String question) {
        String normalized = question.strip().toLowerCase(Locale.ROOT);
        if (DECISION_QUESTION.matcher(normalized).find()) {
            return "No. Loan decisions are not made by AI. A loan officer reviews each application and makes "
                    + "the lending decision. This assistant provides general information only and cannot "
                    + "approve, decline, or predict the outcome of an application.";
        }
        if (DOCUMENT_QUESTION.matcher(normalized).find()) {
            return "For KYC, prepare your national ID, proof of address, payslip, and bank statement. "
                    + "Applicants married in community of property must also provide spousal consent. "
                    + "An officer verifies the documents before you can submit a loan application.";
        }
        if (SPOUSAL_QUESTION.matcher(normalized).find()) {
            return "Spousal consent is required if you are married in community of property. "
                    + "The officer reviews the consent form with your other KYC documents.";
        }
        if (PAYMENT_QUESTION.matcher(normalized).find()) {
            return "At present, repayments are recorded by a loan officer. Online payment gateway and "
                    + "automated debit-order collections are not available. You can message your loan "
                    + "officer from the signed-in workspace.";
        }
        if (STATUS_QUESTION.matcher(normalized).find()) {
            return "Sign in to your borrower workspace to view your KYC review, application status, "
                    + "and loan details. I cannot access personal account records in this chat.";
        }
        if (COMPLAINT_QUESTION.matcher(normalized).find()) {
            return "You can message a loan officer from the signed-in workspace. Staff can record, "
                    + "investigate, resolve, or escalate a complaint.";
        }
        if (REGULATORY_QUESTION.matcher(normalized).find()) {
            return "The LMS is designed for Botswana micro-lending. For official regulatory information, "
                    + "visit NBFIRA at https://www.nbfira.org.bw/. This assistant does not provide legal advice.";
        }
        if (APPLICATION_QUESTION.matcher(normalized).find()) {
            return "To apply, create an account and verify your email, submit the required KYC documents, "
                    + "and wait for an officer to review them. Once KYC is approved, choose a product and "
                    + "submit your application. A loan officer makes the final decision.";
        }
        if (PRODUCT_QUESTION.matcher(normalized).find()) return productAnswer();
        return "I can help with loan products and rates, how to apply, KYC documents, repayments, "
                + "application status, complaints, and responsible borrowing. Please avoid sharing "
                + "passwords, ID numbers, bank details, or other sensitive personal information.";
    }

    private String productAnswer() {
        List<Map<String, Object>> products = jdbc.queryForList("""
                SELECT name, monthly_rate_pct, min_amount, max_amount, min_tenure_months, max_tenure_months
                FROM loan_products
                WHERE is_active = TRUE
                ORDER BY id
                """);
        if (products.isEmpty()) {
            return "Loan product details are temporarily unavailable. Please try again later or contact a loan officer.";
        }
        StringBuilder answer = new StringBuilder("Available products (rates are monthly): ");
        for (int i = 0; i < products.size(); i++) {
            Map<String, Object> product = products.get(i);
            if (i > 0) answer.append("; ");
            answer.append(product.get("name"))
                    .append(": P ").append(money(product.get("min_amount")))
                    .append("–P ").append(money(product.get("max_amount")))
                    .append(", ").append(money(product.get("monthly_rate_pct"))).append("% per month, ")
                    .append(product.get("min_tenure_months")).append("–")
                    .append(product.get("max_tenure_months")).append(" months");
        }
        answer.append(". Estimates and eligibility are subject to review by a loan officer.");
        return answer.toString();
    }

    private static String money(Object value) {
        return new BigDecimal(String.valueOf(value)).setScale(2).toPlainString();
    }
}
