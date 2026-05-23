# مشوارو Security & Sanitization Test Plan

**Test Date:** Pending  
**Platform:** iOS + Android + Web  
**Priority:** CRITICAL before App Store/Play Store launch  

---

## Overview

Sanitization testing ensures user inputs are properly validated and cleaned to prevent:
- **XSS (Cross-Site Scripting)** - Malicious scripts in user content
- **SQL Injection** - Database manipulation through inputs
- **File Upload Attacks** - Malicious files disguised as images/PDFs
- **Path Traversal** - Accessing unauthorized files
- **Command Injection** - Executing system commands

---

## Test Payloads

### XSS Test Payloads
```javascript
const XSS_PAYLOADS = [
  "<script>alert('XSS')</script>",
  "<img src=x onerror=alert('XSS')>",
  "<svg onload=alert('XSS')>",
  "javascript:alert('XSS')",
  "<iframe src='javascript:alert(\"XSS\")'></iframe>",
  "<body onload=alert('XSS')>",
  "';alert('XSS');//",
  "\"><script>alert('XSS')</script>",
  "<a href='javascript:alert(\"XSS\")'>click</a>",
  "<input onfocus=alert('XSS') autofocus>"
];
```

### SQL Injection Test Payloads
```javascript
const SQL_PAYLOADS = [
  "'; DROP TABLE users; --",
  "' OR '1'='1",
  "admin'--",
  "' UNION SELECT * FROM users--",
  "1' AND '1'='1",
  "'; DELETE FROM profiles WHERE '1'='1'; --",
  "' OR 1=1--"
];
```

### Path Traversal Payloads
```javascript
const PATH_PAYLOADS = [
  "../../../etc/passwd",
  "..\\..\\..\\windows\\system32\\config\\sam",
  "../../../../../../../../etc/shadow",
  "....//....//....//etc/passwd"
];
```

---

## Test Matrix

### 1. USER PROFILE FIELDS

#### 1.1 Full Name (الاسم الكامل)
**Location:** AccountSettings.jsx, Onboarding.jsx  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Displays as plain text "<script>alert('XSS')</script>"
Status: [ ] PASS [ ] FAIL
```

**Steps:**
1. Go to Settings → Edit Profile
2. Enter XSS payload in "الاسم الكامل"
3. Save
4. View profile in:
   - [ ] Settings page
   - [ ] Trip card (as driver)
   - [ ] Booking card (as passenger)
   - [ ] Message thread
   - [ ] Review
5. Verify displays as text, doesn't execute

**Additional payloads to test:**
- [ ] `<img src=x onerror=alert('XSS')>`
- [ ] `<svg onload=alert('XSS')>`
- [ ] `';alert('XSS');//`

---

#### 1.2 Bio (نبذة عنك)
**Location:** Onboarding.jsx, AccountSettings.jsx  
**Max length:** 500 chars  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Displays as plain text
Status: [ ] PASS [ ] FAIL
```

**Steps:**
1. Edit bio with XSS payload
2. Save
3. View in driver profile cards
4. Verify sanitized

**Edge cases:**
- [ ] 500 character limit enforced
- [ ] Newlines preserved but safe
- [ ] Emoji handled correctly
- [ ] Arabic + English mixed text

---

#### 1.3 Phone Number (رقم الهاتف)
**Location:** Onboarding.jsx  
**Validation:** Palestinian phone format  
**Test:**
```javascript
// Valid inputs
059XXXXXXX ✓
+970591234567 ✓
+970 59 123 4567 ✓

// Invalid inputs (should reject)
<script>alert('XSS')</script> ✗
'; DROP TABLE--  ✗
abc123 ✗
12345 ✗
```

**Status:** [ ] PASS [ ] FAIL

---

### 2. TRIP-RELATED FIELDS

#### 2.1 Trip Notes (ملاحظات الرحلة)
**Location:** CreateTrip.jsx  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Displays as plain text
Status: [ ] PASS [ ] FAIL
```

**View locations to test:**
- [ ] Trip details page
- [ ] Driver dashboard
- [ ] Passenger booking view

---

#### 2.2 Car Model (موديل السيارة)
**Location:** Onboarding.jsx (custom input mode)  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Displays as plain text
Status: [ ] PASS [ ] FAIL
```

**Note:** Now has dropdown, but custom input still available.

---

#### 2.3 Car Plate (رقم اللوحة)
**Location:** Onboarding.jsx  
**Format:** Palestinian plate format  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Rejected or sanitized
Status: [ ] PASS [ ] FAIL
```

---

### 3. MESSAGING SYSTEM

#### 3.1 Message Content
**Location:** Messages.jsx  
**CRITICAL:** Messages display user-to-user content  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Displays as plain text in message bubble
Status: [ ] PASS [ ] FAIL
```

**Steps:**
1. Send message with XSS payload
2. View in:
   - [ ] Sender's chat view
   - [ ] Recipient's chat view
   - [ ] Message notification
3. Verify no script execution

**Additional payloads:**
- [ ] `<img src=x onerror=alert('XSS')>`
- [ ] `<a href='javascript:alert("XSS")'>click</a>`
- [ ] HTML entities: `&lt;script&gt;`

---

### 4. REVIEWS & RATINGS

#### 4.1 Review Comment (تعليق)
**Location:** PassengerReviewWizard.jsx, DriverReviewWizard.jsx  
**CRITICAL:** Public-facing user content  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Displays as plain text
Status: [ ] PASS [ ] FAIL
```

**View locations:**
- [ ] Driver profile (shows passenger reviews)
- [ ] Passenger profile (shows driver reviews)
- [ ] Review cards in trip details
- [ ] Admin dashboard reviews tab

---

### 5. FILE UPLOADS

#### 5.1 Avatar Upload
**Location:** AccountSettings.jsx, Onboarding.jsx  
**Allowed:** Images only (jpg, png, webp, gif)  
**Test:**
```
Upload: malicious.php.jpg (PHP script disguised as image)
Expected: Rejected OR stored but not executable
Status: [ ] PASS [ ] FAIL
```

**Steps:**
1. Create file: `test.svg` containing:
```xml
<svg xmlns="http://www.w3.org/2000/svg" onload="alert('XSS')">
  <circle cx="50" cy="50" r="40"/>
</svg>
```
2. Try to upload as avatar
3. Verify:
   - [ ] Rejected if not allowed type
   - [ ] If accepted, script doesn't execute when viewed

---

#### 5.2 License Image Upload
**Location:** Onboarding.jsx (driver)  
**Allowed:** Images + PDF  
**Test:**
```
1. Upload: script.pdf containing JavaScript
2. Upload: image.png.exe (executable disguised)
3. Upload: ../../../etc/passwd (path traversal)
Expected: All rejected or safely stored
Status: [ ] PASS [ ] FAIL
```

**Existing validation (verify it works):**
```javascript
function isAllowedUpload(file, { imageOnly }) {
  if (!file?.type) return false;
  if (file.type.startsWith("image/")) return true;
  if (!imageOnly && file.type === "application/pdf") return true;
  return false;
}
```

**Test matrix:**
- [ ] .jpg → ✓ Accept
- [ ] .png → ✓ Accept
- [ ] .pdf → ✓ Accept (license only)
- [ ] .exe → ✗ Reject
- [ ] .php → ✗ Reject
- [ ] .svg → ? (Check if safe)
- [ ] .html → ✗ Reject
- [ ] No extension → ✗ Reject

---

### 6. SEARCH & FILTERS

#### 6.1 City Search (البحث عن مدينة)
**Location:** CityAutocomplete.jsx  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: No results, or sanitized
Status: [ ] PASS [ ] FAIL
```

**SQL Injection test:**
```
Input: '; DELETE FROM cities; --
Expected: No database modification
Status: [ ] PASS [ ] FAIL
```

**Note:** Using Supabase client (parameterized queries), should be safe by default.

---

#### 6.2 Trip Search
**Location:** Home.jsx, SearchTrips.jsx  
**Test:**
```
From: <script>alert('XSS')</script>
To: ' OR '1'='1
Expected: Safe query, no execution
Status: [ ] PASS [ ] FAIL
```

---

### 7. ADMIN DASHBOARD

#### 7.1 Report Reason (سبب البلاغ)
**Location:** UserActionsMenu.jsx  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Admin sees plain text
Status: [ ] PASS [ ] FAIL
```

---

#### 7.2 License Rejection Reason
**Location:** Dashboard → Licenses  
**Test:**
```
Input: <script>alert('XSS')</script>
Expected: Driver sees plain text in notification
Status: [ ] PASS [ ] FAIL
```

---

### 8. URL PARAMETERS

#### 8.1 Deep Links
**Test these URLs for XSS:**
```
/trip/<script>alert('XSS')</script>
/messages?to=<script>alert('XSS')</script>
/profile?email=';DROP TABLE users;--
```

**Expected:** Parameters sanitized or rejected  
**Status:** [ ] PASS [ ] FAIL

---

#### 8.2 returnTo Parameter
**Location:** Login.jsx, Onboarding.jsx  
**CRITICAL:** Path traversal risk  
**Existing protection:**
```javascript
const safeReturn = rawReturn && rawReturn.startsWith("/") && !rawReturn.startsWith("//")
  ? rawReturn
  : null;
```

**Test:**
```
?returnTo=javascript:alert('XSS') → Should reject
?returnTo=//evil.com → Should reject
?returnTo=/settings → Should accept ✓
```

**Status:** [ ] PASS [ ] FAIL

---

## Automated Test Script

```javascript
// Run this in browser console on each input field
const XSS_PAYLOADS = [
  "<script>alert('XSS')</script>",
  "<img src=x onerror=alert('XSS')>",
  "javascript:alert('XSS')",
  "<svg onload=alert('XSS')>"
];

async function testInput(selector, payloads) {
  const input = document.querySelector(selector);
  if (!input) {
    console.error(`Input not found: ${selector}`);
    return;
  }
  
  for (const payload of payloads) {
    console.log(`Testing: ${payload}`);
    input.value = payload;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    
    // Check if payload is in DOM as executable
    if (document.body.innerHTML.includes(payload) && 
        !document.body.textContent.includes(payload)) {
      console.error(`⚠️ VULNERABILITY: ${payload} executed!`);
    } else {
      console.log(`✓ Safe: ${payload} sanitized`);
    }
  }
}

// Test full name field
testInput('input[placeholder*="الاسم"]', XSS_PAYLOADS);

// Test bio field
testInput('textarea[placeholder*="نبذة"]', XSS_PAYLOADS);

// Test message field
testInput('textarea[placeholder*="رسالة"]', XSS_PAYLOADS);
```

---

## React/Supabase Built-in Protections

### ✅ Already Safe:

1. **React automatically escapes JSX:**
```javascript
// This is safe by default:
<div>{user.name}</div>  // Even if name = "<script>alert('XSS')</script>"
```

2. **Supabase uses parameterized queries:**
```javascript
// Safe - parameters are escaped:
await supabase.from('users').select().eq('email', userInput);
```

3. **dangerouslySetInnerHTML not used anywhere** (verify):
```bash
cd /home/claude/Mishwar
grep -r "dangerouslySetInnerHTML" src/
# Should return: (empty)
```

### ⚠️ Need to verify:

1. **User content in notifications:**
```javascript
// Check if notification messages escape HTML
<div>{notification.message}</div>
```

2. **Markdown or rich text:**
```bash
# Check if any markdown renderers are used
grep -r "markdown\|rich-text\|wysiwyg" src/
```

---

## Testing Checklist

### Pre-Launch Critical Tests:
- [ ] Full name field (XSS in profile views)
- [ ] Bio field (XSS in driver cards)
- [ ] Message content (XSS in chat)
- [ ] Review comments (XSS in public reviews)
- [ ] File uploads (malicious files)
- [ ] URL parameters (XSS in links)

### High Priority:
- [ ] Car model custom input
- [ ] Trip notes
- [ ] Report reasons
- [ ] City suggestions
- [ ] Search inputs

### Medium Priority:
- [ ] Phone number validation
- [ ] License number validation
- [ ] Car year validation
- [ ] Car plate format

---

## Test Results Template

```markdown
## Test Session: [Date]
**Tester:** [Name]
**Platform:** [iOS/Android/Web]
**Build:** [Version]

### XSS Tests
| Field | Payload | Result | Notes |
|-------|---------|--------|-------|
| Full Name | `<script>alert('XSS')</script>` | PASS/FAIL | |
| Bio | `<img src=x onerror=alert('XSS')>` | PASS/FAIL | |
| Message | `<svg onload=alert('XSS')>` | PASS/FAIL | |

### File Upload Tests
| File Type | Result | Notes |
|-----------|--------|-------|
| .jpg | PASS/FAIL | |
| .pdf | PASS/FAIL | |
| .exe | PASS/FAIL | Should reject |
| .svg | PASS/FAIL | Check if safe |

### SQL Injection Tests
| Field | Payload | Result | Notes |
|-------|---------|--------|-------|
| City Search | `'; DROP TABLE--` | PASS/FAIL | |
| Email | `' OR '1'='1` | PASS/FAIL | |

### Issues Found:
1. [Description]
2. [Description]

### Recommendations:
1. [Fix/Enhancement]
2. [Fix/Enhancement]
```

---

## Security Best Practices (Already Implemented)

✅ **Input Validation:**
- Phone: `validatePhone()` function
- License: Regex `/^[a-zA-Z0-9\s\-]+$/`
- Car year: Min/max numeric range
- File types: MIME type checking

✅ **Authentication:**
- JWT-based (Supabase)
- Row Level Security (RLS)
- SECURITY DEFINER functions for admin actions

✅ **Authorization:**
- Guard triggers prevent unauthorized changes
- RLS policies restrict data access
- Admin role checked server-side

---

## Next Steps

1. [ ] Run XSS tests on all user input fields
2. [ ] Verify file upload restrictions
3. [ ] Test URL parameter handling
4. [ ] Document any vulnerabilities found
5. [ ] Fix issues before app store submission
6. [ ] Re-test after fixes
7. [ ] Get security review approval

---

**Last Updated:** May 23, 2026  
**Status:** Test plan created, testing pending  
**Priority:** CRITICAL - Must complete before iOS/Android launch
