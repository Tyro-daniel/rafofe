package bw.co.refofe.lms.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import bw.co.refofe.lms.api.ApiException;
import org.junit.jupiter.api.Test;

class PhoneNumberTest {
    @Test
    void normalizesBotswanaLocalNumbers() {
        assertEquals("+26771234567", PhoneNumber.toE164("71 234 567"));
        assertEquals("+26771234567", PhoneNumber.toE164("071234567"));
        assertEquals("+26771234567", PhoneNumber.toE164("26771234567"));
    }

    @Test
    void preservesValidInternationalNumbers() {
        assertEquals("+12025550123", PhoneNumber.toE164("+1 (202) 555-0123"));
        assertEquals("+26771234567", PhoneNumber.toE164("0026771234567"));
    }

    @Test
    void rejectsInvalidNumbers() {
        assertThrows(ApiException.class, () -> PhoneNumber.toE164(""));
        assertThrows(ApiException.class, () -> PhoneNumber.toE164("not a phone number"));
    }
}
