package bw.co.refofe.lms.service;

import bw.co.refofe.lms.api.ApiException;

public final class PhoneNumber {
    private PhoneNumber() {}

    public static String toE164(String value) {
        if (value == null || value.isBlank()) throw ApiException.badRequest("Phone number is required");
        String compact = value.trim().replaceAll("[\\s()-]", "");
        if (compact.startsWith("00")) compact = "+" + compact.substring(2);
        if (compact.matches("0\\d{7,8}")) compact = "+267" + compact.substring(1);
        else if (compact.matches("\\d{7,8}")) compact = "+267" + compact;
        else if (compact.matches("267\\d{7,8}")) compact = "+" + compact;
        if (!compact.matches("\\+[1-9]\\d{7,14}")) {
            throw ApiException.badRequest("Enter a valid phone number with country code, or a Botswana local number");
        }
        return compact;
    }
}
