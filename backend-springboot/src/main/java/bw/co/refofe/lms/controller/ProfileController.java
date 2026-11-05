package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.service.PhoneNumber;
import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Map;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.MediaType;

@RestController
@RequestMapping("/profile")
public class ProfileController {
    private static final long MAX_IMAGE_BYTES = 2L * 1024 * 1024;
    private static final long MAX_IMAGE_PIXELS = 8_000_000L;
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;

    public ProfileController(JdbcTemplate jdbc, AuthSupport authSupport) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
    }

    @GetMapping("/me")
    public Map<String, Object> myProfile(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireUser(request);
        Map<String, Object> profile = jdbc.queryForMap("""
                SELECT full_name AS "fullName", email, phone, profile_picture AS picture,
                       profile_picture_type AS "pictureType"
                FROM users WHERE id = ?
                """, user.id());
        byte[] picture = (byte[]) profile.remove("picture");
        String pictureType = (String) profile.remove("pictureType");
        profile.put("profilePictureUrl", picture == null
                ? null
                : "data:" + pictureType + ";base64," + Base64.getEncoder().encodeToString(picture));
        return profile;
    }

    @PatchMapping("/me")
    public Map<String, Object> updateProfile(
            HttpServletRequest request, @RequestBody Map<String, Object> body) {
        AuthenticatedUser user = authSupport.requireUser(request);
        Object nameValue = body.get("fullName");
        Object phoneValue = body.get("phone");
        if (!(nameValue instanceof String fullName) || fullName.trim().length() < 2
                || fullName.trim().length() > 255) {
            throw ApiException.badRequest("Full name must contain between 2 and 255 characters");
        }
        if (phoneValue != null && !(phoneValue instanceof String)) {
            throw ApiException.badRequest("Phone number must be text");
        }
        String phone = phoneValue instanceof String value && !value.isBlank() ? value.trim() : null;
        if (phone != null && phone.length() > 50) throw ApiException.badRequest("Phone number is too long");
        if (phone != null && "customer".equals(user.role())) phone = PhoneNumber.toE164(phone);
        jdbc.update("UPDATE users SET full_name = ?, phone = ? WHERE id = ?",
                fullName.trim(), phone, user.id());
        return myProfile(request);
    }

    @PostMapping(value = "/picture", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> uploadPicture(
            HttpServletRequest request, @RequestParam("file") MultipartFile file) {
        AuthenticatedUser user = authSupport.requireUser(request);
        if (file.isEmpty() || file.getSize() > MAX_IMAGE_BYTES) {
            throw ApiException.badRequest("Choose an image smaller than 2 MB");
        }
        byte[] image;
        try {
            image = file.getBytes();
        } catch (IOException error) {
            throw ApiException.badRequest("The image could not be read");
        }
        String type = validateImage(image, file.getContentType());
        jdbc.update("UPDATE users SET profile_picture = ?, profile_picture_type = ? WHERE id = ?",
                image, type, user.id());
        return myProfile(request);
    }

    @DeleteMapping("/picture")
    public Map<String, Object> removePicture(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireUser(request);
        jdbc.update("UPDATE users SET profile_picture = NULL, profile_picture_type = NULL WHERE id = ?", user.id());
        return myProfile(request);
    }

    private static String validateImage(byte[] bytes, String contentType) {
        if (!MediaType.IMAGE_JPEG_VALUE.equalsIgnoreCase(contentType)
                && !MediaType.IMAGE_PNG_VALUE.equalsIgnoreCase(contentType)) {
            throw ApiException.badRequest("Profile pictures must be JPEG or PNG images");
        }
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (input == null) throw ApiException.badRequest("The selected file is not a valid image");
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw ApiException.badRequest("The selected file is not a valid image");
            ImageReader reader = readers.next();
            try {
                reader.setInput(input, true, true);
                String format = reader.getFormatName();
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                boolean jpeg = format.equalsIgnoreCase("JPEG") || format.equalsIgnoreCase("JPG");
                boolean png = format.equalsIgnoreCase("PNG");
                if ((!jpeg && !png)
                        || (jpeg && !MediaType.IMAGE_JPEG_VALUE.equalsIgnoreCase(contentType))
                        || (png && !MediaType.IMAGE_PNG_VALUE.equalsIgnoreCase(contentType))) {
                    throw ApiException.badRequest("The image content does not match its file type");
                }
                if (width < 1 || height < 1 || (long) width * height > MAX_IMAGE_PIXELS) {
                    throw ApiException.badRequest("The image dimensions are too large");
                }
                if (reader.read(0) == null) throw ApiException.badRequest("The selected file is not a valid image");
                return jpeg ? MediaType.IMAGE_JPEG_VALUE : MediaType.IMAGE_PNG_VALUE;
            } finally {
                reader.dispose();
            }
        } catch (IOException error) {
            throw ApiException.badRequest("The selected file is not a valid image");
        }
    }
}
